package routes

import (
	"github.com/go-chi/chi/v5"

	"github.com/junginho0901/kubeast/services/k8s-service-go/internal/handler"
)

// RegisterCustomResources — CRDs and custom resource instances.
func RegisterCustomResources(r chi.Router, h *handler.Handler) {
	// Custom Resource Definitions (cluster-scoped)
	r.Get("/api/v1/crds", h.GetCRDs)
	r.Get("/api/v1/crds/{name}/describe", h.DescribeCRD)
	r.Delete("/api/v1/crds/{name}", h.DeleteCRD)

	// Custom Resource Instances
	r.Get("/api/v1/custom-resources/all", h.GetAllCustomResourceInstances)
	r.Get("/api/v1/custom-resources/{group}/{version}/{plural}", h.GetCustomResourceInstances)
	r.Get("/api/v1/custom-resources/{group}/{version}/{plural}/{namespace}/{name}/describe", h.DescribeCustomResourceInstance)
	r.Delete("/api/v1/custom-resources/{group}/{version}/{plural}/{namespace}/{name}", h.DeleteCustomResourceInstance)
}
