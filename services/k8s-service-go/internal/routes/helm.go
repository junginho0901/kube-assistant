package routes

import (
	"github.com/go-chi/chi/v5"

	"github.com/junginho0901/kubeast/services/k8s-service-go/internal/handler"
)

// RegisterHelm — Helm release read endpoints (v1.0), write endpoints
// (v1.1), and the WebSocket watch (replaces 30s polling).
//
// Order matters: the literal "watch" path and concrete sub-paths
// (history, resources, images, …) must be registered BEFORE the
// {namespace}/{name} catch-all and the {section} wildcard, so chi
// matches them as literals rather than path parameters.
func RegisterHelm(r chi.Router, h *handler.Handler) {
	r.Get("/api/v1/helm/releases", h.GetHelmReleases)

	// Real-time release watch — must come BEFORE the {namespace}/{name}
	// route so chi treats "watch" as a literal segment, not a namespace.
	r.Get("/api/v1/helm/releases/watch", h.WatchHelmReleases)

	r.Get("/api/v1/helm/releases/{namespace}/{name}", h.GetHelmRelease)
	r.Get("/api/v1/helm/releases/{namespace}/{name}/history", h.GetHelmReleaseHistory)
	r.Get("/api/v1/helm/releases/{namespace}/{name}/resources", h.GetHelmReleaseResources)
	r.Get("/api/v1/helm/releases/{namespace}/{name}/images", h.GetHelmReleaseImages)
	r.Post("/api/v1/helm/releases/{namespace}/{name}/diff", h.DiffHelmRelease)
	r.Get("/api/v1/helm/releases/{namespace}/{name}/revisions/{revision}/{section}", h.GetHelmRevisionSection)

	// Helm writes (v1.1)
	r.Post("/api/v1/helm/releases/{namespace}/{name}/rollback", h.RollbackHelmRelease)
	r.Post("/api/v1/helm/releases/{namespace}/{name}/test", h.TestHelmRelease)
	r.Put("/api/v1/helm/releases/{namespace}/{name}/values", h.UpgradeHelmValues)
	r.Delete("/api/v1/helm/releases/{namespace}/{name}", h.UninstallHelmRelease)

	// Keep the {section} catch-all last so chi resolves literal
	// segments ('history', 'resources', …) before the wildcard.
	r.Get("/api/v1/helm/releases/{namespace}/{name}/{section}", h.GetHelmReleaseSection)
}
