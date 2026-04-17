package helm

import (
	"context"
	"encoding/json"
	"fmt"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/release"
	"sigs.k8s.io/yaml"
)

// GetRelease returns the full detail for the latest revision of a release.
// For per-revision lookups the caller should use GetRevision instead.
func (s *Service) GetRelease(ctx context.Context, namespace, name string) (*ReleaseDetail, error) {
	rel, err := s.fetchRelease(ctx, namespace, name, 0)
	if err != nil {
		return nil, err
	}
	return buildDetail(rel), nil
}

// GetSection returns one slice of a release's latest revision — manifest,
// values, notes, or hooks — rendered as the wire format the UI expects:
//   - manifest: YAML string (Helm keeps it pre-rendered)
//   - values:   YAML string of the user-supplied config (empty map if none)
//   - notes:    the raw NOTES.txt string
//   - hooks:    YAML string concatenating every hook's manifest
//
// Why strings everywhere: the frontend already has a YAML viewer, and
// keeping a uniform shape means one generic handler serves all kinds.
func (s *Service) GetSection(ctx context.Context, namespace, name string, kind SectionKind) (string, error) {
	return s.GetRevisionSection(ctx, namespace, name, 0, kind)
}

// GetRevision returns the same detail shape as GetRelease but for a
// specific revision. Used by the history detail view and by the diff
// endpoint to pull "before" state.
func (s *Service) GetRevision(ctx context.Context, namespace, name string, revision int) (*ReleaseDetail, error) {
	if revision <= 0 {
		return nil, fmt.Errorf("revision must be positive")
	}
	rel, err := s.fetchRelease(ctx, namespace, name, revision)
	if err != nil {
		return nil, err
	}
	return buildDetail(rel), nil
}

// GetRevisionSection is the shared implementation behind GetSection and
// the per-revision section endpoint. revision == 0 means "latest".
//
// Exported rather than internal because the diff endpoint and the
// revision-section HTTP handler both need it — keeping it private
// would force one or both to duplicate the section-dispatch switch.
func (s *Service) GetRevisionSection(ctx context.Context, namespace, name string, revision int, kind SectionKind) (string, error) {
	if !kind.IsValid() {
		return "", ErrInvalidSection
	}
	rel, err := s.fetchRelease(ctx, namespace, name, revision)
	if err != nil {
		return "", err
	}

	switch kind {
	case SectionManifest:
		return rel.Manifest, nil
	case SectionNotes:
		if rel.Info == nil {
			return "", nil
		}
		return rel.Info.Notes, nil
	case SectionValues:
		return marshalValues(rel.Config)
	case SectionHooks:
		return concatHooks(rel), nil
	}
	return "", ErrInvalidSection
}

// fetchRelease pulls a release from Helm storage. revision == 0 resolves
// to the latest deployed revision via action.Get; otherwise action.Get
// with Version set is used.
func (s *Service) fetchRelease(ctx context.Context, namespace, name string, revision int) (*release.Release, error) {
	cfg, err := s.actionConfig(ctx, namespace)
	if err != nil {
		return nil, err
	}
	getter := action.NewGet(cfg)
	getter.Version = revision
	rel, err := getter.Run(name)
	if err != nil {
		return nil, translateSDKError(err)
	}
	return rel, nil
}

// buildDetail serializes a Helm release into our ReleaseDetail DTO.
// Values is returned as map[string]interface{} (matches the wire type);
// callers that want YAML should call GetSection(SectionValues).
func buildDetail(rel *release.Release) *ReleaseDetail {
	d := &ReleaseDetail{ReleaseSummary: toSummary(rel), Manifest: rel.Manifest}
	if rel.Info != nil {
		d.Description = rel.Info.Description
		d.Notes = rel.Info.Notes
	}
	if len(rel.Config) > 0 {
		// Round-trip through JSON so nested types (helm.Values aliases)
		// flatten to plain map[string]interface{} for JSON encoding.
		if b, err := json.Marshal(rel.Config); err == nil {
			var out map[string]interface{}
			if json.Unmarshal(b, &out) == nil {
				d.Values = out
			}
		}
	}
	return d
}

// marshalValues serializes a release's user-supplied config map to YAML.
// An empty or nil map returns the empty string rather than "null\n" so
// the UI can show an empty editor instead of a literal "null" line.
func marshalValues(cfg map[string]interface{}) (string, error) {
	if len(cfg) == 0 {
		return "", nil
	}
	b, err := yaml.Marshal(cfg)
	if err != nil {
		return "", fmt.Errorf("marshal values: %w", err)
	}
	return string(b), nil
}

// concatHooks joins every hook manifest with YAML document separators.
// Matches `helm get hooks` output exactly.
func concatHooks(rel *release.Release) string {
	if len(rel.Hooks) == 0 {
		return ""
	}
	var out string
	for i, h := range rel.Hooks {
		if i > 0 {
			out += "\n---\n"
		}
		out += h.Manifest
	}
	return out
}
