package helm

import (
	"context"
	"sort"

	"helm.sh/helm/v3/pkg/action"
)

// GetHistory returns all revisions known for the release, newest first.
// Helm SDK returns history in storage-iteration order which is not
// guaranteed; we sort descending by revision number so the UI can
// render the list without re-sorting.
func (s *Service) GetHistory(ctx context.Context, namespace, name string) ([]HistoryEntry, error) {
	cfg, err := s.actionConfig(ctx, namespace)
	if err != nil {
		return nil, err
	}

	hist := action.NewHistory(cfg)
	hist.Max = 0 // 0 = all; Helm treats negative or zero as unlimited
	revs, err := hist.Run(name)
	if err != nil {
		return nil, translateSDKError(err)
	}

	out := make([]HistoryEntry, 0, len(revs))
	for _, r := range revs {
		e := HistoryEntry{Revision: r.Version}
		if r.Info != nil {
			e.Status = r.Info.Status.String()
			e.Updated = r.Info.LastDeployed.Time
			e.Description = r.Info.Description
		}
		if r.Chart != nil && r.Chart.Metadata != nil {
			e.ChartVersion = r.Chart.Metadata.Version
			e.AppVersion = r.Chart.Metadata.AppVersion
		}
		out = append(out, e)
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Revision > out[j].Revision })
	return out, nil
}
