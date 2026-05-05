package routes

import (
	"github.com/go-chi/chi/v5"

	"github.com/junginho0901/kubeast/services/k8s-service-go/internal/ws"
)

// RegisterWS — WebSocket multiplexer for real-time K8s resource watch.
//
// Both /api/v1/ws and /api/v1/wsMultiplexer point at the same handler;
// /api/v1/ws is the new short alias and /api/v1/wsMultiplexer is kept
// for backwards compatibility with older frontend builds.
func RegisterWS(r chi.Router, wsMux *ws.Multiplexer) {
	r.Get("/api/v1/ws", wsMux.HandleWebSocket)
	r.Get("/api/v1/wsMultiplexer", wsMux.HandleWebSocket)
}
