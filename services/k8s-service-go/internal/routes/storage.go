package routes

import (
	"github.com/go-chi/chi/v5"

	"github.com/junginho0901/kubeast/services/k8s-service-go/internal/handler"
)

// RegisterStorage — PersistentVolumeClaim, PersistentVolume,
// StorageClass, VolumeAttachment.
func RegisterStorage(r chi.Router, h *handler.Handler) {
	// PVCs
	r.Get("/api/v1/pvcs", h.GetAllPVCs)
	r.Get("/api/v1/namespaces/{namespace}/pvcs", h.GetPVCs)
	r.Get("/api/v1/namespaces/{namespace}/pvcs/{name}/describe", h.DescribePVC)
	r.Get("/api/v1/namespaces/{namespace}/pvcs/{name}/yaml", h.GetPVCYAML)
	r.Delete("/api/v1/namespaces/{namespace}/pvcs/{name}", h.DeletePVC)

	// PVs
	r.Get("/api/v1/pvs", h.GetPVs)
	r.Get("/api/v1/pvs/{name}", h.GetPV)
	r.Get("/api/v1/pvs/{name}/describe", h.DescribePV)
	r.Get("/api/v1/pvs/{name}/yaml", h.GetPVYAML)
	r.Delete("/api/v1/pvs/{name}", h.DeletePV)

	// StorageClasses
	r.Get("/api/v1/storageclasses", h.GetStorageClasses)
	r.Get("/api/v1/storageclasses/{name}", h.GetStorageClass)
	r.Get("/api/v1/storageclasses/{name}/describe", h.DescribeStorageClass)
	r.Delete("/api/v1/storageclasses/{name}", h.DeleteStorageClass)

	// VolumeAttachments
	r.Get("/api/v1/volumeattachments", h.GetVolumeAttachments)
	r.Get("/api/v1/volumeattachments/{name}/describe", h.DescribeVolumeAttachment)
	r.Delete("/api/v1/volumeattachments/{name}", h.DeleteVolumeAttachment)
}
