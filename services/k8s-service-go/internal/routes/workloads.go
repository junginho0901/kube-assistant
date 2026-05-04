package routes

import (
	"github.com/go-chi/chi/v5"

	"github.com/junginho0901/kubeast/services/k8s-service-go/internal/handler"
)

// RegisterWorkloads — Deployment, StatefulSet, DaemonSet, ReplicaSet,
// Job, CronJob.
func RegisterWorkloads(r chi.Router, h *handler.Handler) {
	// Deployments
	r.Get("/api/v1/deployments/all", h.GetAllDeployments)
	r.Get("/api/v1/namespaces/{namespace}/deployments", h.GetDeployments)
	r.Get("/api/v1/namespaces/{namespace}/deployments/{name}/describe", h.DescribeDeployment)
	r.Get("/api/v1/namespaces/{namespace}/deployments/{name}/yaml", h.GetDeploymentYAML)
	r.Get("/api/v1/namespaces/{namespace}/deployments/{name}/revisions", h.GetWorkloadRevisions)
	r.Post("/api/v1/namespaces/{namespace}/deployments/{name}/rollback", h.RollbackWorkload)
	r.Delete("/api/v1/namespaces/{namespace}/deployments/{deployment_name}", h.DeleteDeployment)

	// StatefulSets
	r.Get("/api/v1/statefulsets/all", h.GetAllStatefulSets)
	r.Get("/api/v1/namespaces/{namespace}/statefulsets", h.GetStatefulSets)
	r.Get("/api/v1/namespaces/{namespace}/statefulsets/{name}/describe", h.DescribeStatefulSet)
	r.Get("/api/v1/namespaces/{namespace}/statefulsets/{name}/yaml", h.GetStatefulSetYAML)
	r.Get("/api/v1/namespaces/{namespace}/statefulsets/{name}/revisions", h.GetWorkloadRevisions)
	r.Post("/api/v1/namespaces/{namespace}/statefulsets/{name}/rollback", h.RollbackWorkload)
	r.Delete("/api/v1/namespaces/{namespace}/statefulsets/{name}", h.DeleteStatefulSet)

	// DaemonSets
	r.Get("/api/v1/daemonsets/all", h.GetAllDaemonSets)
	r.Get("/api/v1/namespaces/{namespace}/daemonsets", h.GetDaemonSets)
	r.Get("/api/v1/namespaces/{namespace}/daemonsets/{name}/describe", h.DescribeDaemonSet)
	r.Get("/api/v1/namespaces/{namespace}/daemonsets/{name}/yaml", h.GetDaemonSetYAML)
	r.Get("/api/v1/namespaces/{namespace}/daemonsets/{name}/revisions", h.GetWorkloadRevisions)
	r.Post("/api/v1/namespaces/{namespace}/daemonsets/{name}/rollback", h.RollbackWorkload)
	r.Delete("/api/v1/namespaces/{namespace}/daemonsets/{name}", h.DeleteDaemonSet)

	// ReplicaSets
	r.Get("/api/v1/replicasets/all", h.GetAllReplicaSets)
	r.Get("/api/v1/namespaces/{namespace}/replicasets", h.GetReplicaSets)
	r.Get("/api/v1/namespaces/{namespace}/replicasets/{name}/describe", h.DescribeReplicaSet)
	r.Get("/api/v1/namespaces/{namespace}/replicasets/{name}/yaml", h.GetReplicaSetYAML)
	r.Delete("/api/v1/namespaces/{namespace}/replicasets/{name}", h.DeleteReplicaSet)

	// Jobs
	r.Get("/api/v1/jobs/all", h.GetAllJobs)
	r.Get("/api/v1/namespaces/{namespace}/jobs", h.GetJobs)
	r.Get("/api/v1/namespaces/{namespace}/jobs/{name}/describe", h.DescribeJob)
	r.Get("/api/v1/namespaces/{namespace}/jobs/{name}/yaml", h.GetJobYAML)
	r.Delete("/api/v1/namespaces/{namespace}/jobs/{name}", h.DeleteJob)

	// CronJobs
	r.Get("/api/v1/cronjobs/all", h.GetAllCronJobs)
	r.Get("/api/v1/namespaces/{namespace}/cronjobs", h.GetCronJobs)
	r.Get("/api/v1/namespaces/{namespace}/cronjobs/{name}/describe", h.DescribeCronJob)
	r.Get("/api/v1/namespaces/{namespace}/cronjobs/{name}/yaml", h.GetCronJobYAML)
	r.Patch("/api/v1/namespaces/{namespace}/cronjobs/{name}/suspend", h.SuspendCronJob)
	r.Post("/api/v1/namespaces/{namespace}/cronjobs/{name}/trigger", h.TriggerCronJob)
	r.Get("/api/v1/namespaces/{namespace}/cronjobs/{name}/jobs", h.GetCronJobOwnedJobs)
	r.Delete("/api/v1/namespaces/{namespace}/cronjobs/{name}", h.DeleteCronJob)
}
