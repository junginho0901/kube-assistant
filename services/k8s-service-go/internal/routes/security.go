package routes

import (
	"github.com/go-chi/chi/v5"

	"github.com/junginho0901/kubeast/services/k8s-service-go/internal/handler"
)

// RegisterSecurity — ServiceAccount, Role, RoleBinding.
//
// ClusterRole / ClusterRoleBinding live alongside these conceptually
// but are not yet exposed; add here when they are.
func RegisterSecurity(r chi.Router, h *handler.Handler) {
	// ServiceAccounts
	r.Get("/api/v1/serviceaccounts/all", h.GetAllServiceAccounts)
	r.Get("/api/v1/namespaces/{namespace}/serviceaccounts", h.GetServiceAccounts)
	r.Get("/api/v1/namespaces/{namespace}/serviceaccounts/{name}/describe", h.DescribeServiceAccount)
	r.Get("/api/v1/namespaces/{namespace}/serviceaccounts/{name}/yaml", h.GetServiceAccountYAML)
	r.Delete("/api/v1/namespaces/{namespace}/serviceaccounts/{name}", h.DeleteServiceAccount)

	// Roles
	r.Get("/api/v1/roles/all", h.GetAllRoles)
	r.Get("/api/v1/namespaces/{namespace}/roles", h.GetRoles)
	r.Get("/api/v1/namespaces/{namespace}/roles/{name}/describe", h.DescribeRole)
	r.Get("/api/v1/namespaces/{namespace}/roles/{name}/yaml", h.GetRoleYAML)
	r.Delete("/api/v1/namespaces/{namespace}/roles/{name}", h.DeleteRole)

	// RoleBindings
	r.Get("/api/v1/rolebindings/all", h.GetAllRoleBindings)
	r.Get("/api/v1/namespaces/{namespace}/rolebindings", h.GetRoleBindings)
	r.Get("/api/v1/namespaces/{namespace}/rolebindings/{name}/describe", h.DescribeRoleBinding)
	r.Get("/api/v1/namespaces/{namespace}/rolebindings/{name}/yaml", h.GetRoleBindingYAML)
	r.Delete("/api/v1/namespaces/{namespace}/rolebindings/{name}", h.DeleteRoleBinding)
}
