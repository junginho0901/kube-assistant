package helm

import (
	"bufio"
	"context"
	"sort"
	"strings"

	"sigs.k8s.io/yaml"
)

// manifestObject is the minimum shape we need to walk the rendered
// manifest — kind/name/namespace for resource listing, and the pod
// template spec for image extraction.
type manifestObject struct {
	Kind       string `json:"kind"`
	APIVersion string `json:"apiVersion"`
	Metadata   struct {
		Name      string `json:"name"`
		Namespace string `json:"namespace"`
	} `json:"metadata"`
	Spec struct {
		// Deployment / StatefulSet / DaemonSet / ReplicaSet / Job share this
		Template struct {
			Spec struct {
				Containers     []manifestContainer `json:"containers"`
				InitContainers []manifestContainer `json:"initContainers"`
			} `json:"spec"`
		} `json:"template"`
		// CronJob wraps one level deeper
		JobTemplate struct {
			Spec struct {
				Template struct {
					Spec struct {
						Containers     []manifestContainer `json:"containers"`
						InitContainers []manifestContainer `json:"initContainers"`
					} `json:"spec"`
				} `json:"template"`
			} `json:"spec"`
		} `json:"jobTemplate"`
		// bare Pod
		Containers     []manifestContainer `json:"containers"`
		InitContainers []manifestContainer `json:"initContainers"`
	} `json:"spec"`
}

type manifestContainer struct {
	Name  string `json:"name"`
	Image string `json:"image"`
}

// GetResources returns the list of Kubernetes resources the release
// manifest declares, in the order they appear. When a document has no
// namespace set, the release's namespace is assumed — matches how Helm
// itself treats manifest-level defaults at install time.
func (s *Service) GetResources(ctx context.Context, namespace, name string) ([]ReleaseResource, error) {
	rel, err := s.fetchRelease(ctx, namespace, name, 0)
	if err != nil {
		return nil, err
	}

	objs, err := splitManifest(rel.Manifest)
	if err != nil {
		return nil, err
	}

	out := make([]ReleaseResource, 0, len(objs))
	for _, o := range objs {
		if o.Kind == "" || o.Metadata.Name == "" {
			continue
		}
		ns := o.Metadata.Namespace
		if ns == "" && !isClusterScoped(o.Kind) {
			ns = rel.Namespace
		}
		out = append(out, ReleaseResource{
			Kind:       o.Kind,
			APIVersion: o.APIVersion,
			Name:       o.Metadata.Name,
			Namespace:  ns,
		})
	}
	return out, nil
}

// GetImages returns every distinct container image referenced by the
// release's manifest. Deduped and sorted so the UI renders a stable
// list, and handy for a future "what's vulnerable in this release"
// workflow (see §11).
func (s *Service) GetImages(ctx context.Context, namespace, name string) ([]string, error) {
	rel, err := s.fetchRelease(ctx, namespace, name, 0)
	if err != nil {
		return nil, err
	}

	objs, err := splitManifest(rel.Manifest)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]struct{})
	for _, o := range objs {
		// Pod template spec (Deployment/StatefulSet/DaemonSet/ReplicaSet/Job)
		for _, c := range o.Spec.Template.Spec.Containers {
			seen[c.Image] = struct{}{}
		}
		for _, c := range o.Spec.Template.Spec.InitContainers {
			seen[c.Image] = struct{}{}
		}
		// CronJob
		for _, c := range o.Spec.JobTemplate.Spec.Template.Spec.Containers {
			seen[c.Image] = struct{}{}
		}
		for _, c := range o.Spec.JobTemplate.Spec.Template.Spec.InitContainers {
			seen[c.Image] = struct{}{}
		}
		// Bare Pod
		for _, c := range o.Spec.Containers {
			seen[c.Image] = struct{}{}
		}
		for _, c := range o.Spec.InitContainers {
			seen[c.Image] = struct{}{}
		}
	}
	delete(seen, "")

	out := make([]string, 0, len(seen))
	for img := range seen {
		out = append(out, img)
	}
	sort.Strings(out)
	return out, nil
}

// splitManifest decodes the concatenated YAML manifest Helm stores on
// every release into separate typed objects. We rely on sigs.k8s.io/yaml
// because it handles the JSON-struct-tag idiom; the manifest is split on
// the "^---" document boundary like the kubectl tooling does.
func splitManifest(manifest string) ([]manifestObject, error) {
	var out []manifestObject
	var cur strings.Builder
	flush := func() error {
		s := strings.TrimSpace(cur.String())
		cur.Reset()
		if s == "" {
			return nil
		}
		var obj manifestObject
		if err := yaml.Unmarshal([]byte(s), &obj); err != nil {
			// Malformed document — skip rather than failing the whole
			// release view. Helm itself does the same on `helm get all`.
			return nil
		}
		out = append(out, obj)
		return nil
	}

	scanner := bufio.NewScanner(strings.NewReader(manifest))
	scanner.Buffer(make([]byte, 1024*1024), 4*1024*1024) // large manifests
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "---") {
			if err := flush(); err != nil {
				return nil, err
			}
			continue
		}
		cur.WriteString(line)
		cur.WriteString("\n")
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if err := flush(); err != nil {
		return nil, err
	}
	return out, nil
}

// isClusterScoped returns true for kinds that never carry a namespace.
// The list is intentionally small — we only need it to avoid painting
// the release namespace onto cluster-scoped rows in the UI.
func isClusterScoped(kind string) bool {
	switch kind {
	case "Namespace",
		"Node",
		"PersistentVolume",
		"StorageClass",
		"ClusterRole",
		"ClusterRoleBinding",
		"CustomResourceDefinition",
		"PriorityClass",
		"RuntimeClass",
		"IngressClass",
		"GatewayClass",
		"APIService",
		"MutatingWebhookConfiguration",
		"ValidatingWebhookConfiguration":
		return true
	}
	return false
}
