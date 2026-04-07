package k8s

import (
	"context"
	"fmt"
	"sort"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// TimelineResult holds merged events and rollout history for a timeline view.
type TimelineResult struct {
	Events         []map[string]interface{} `json:"events"`
	RolloutHistory []map[string]interface{} `json:"rollout_history"`
	Summary        map[string]interface{}   `json:"summary"`
}

// buildTimelineResult constructs the final timeline response with summary.
func buildTimelineResult(events, rollouts []map[string]interface{}, cutoff time.Time) *TimelineResult {
	normalCount := 0
	warningCount := 0
	for _, e := range events {
		if e["type"] == "Warning" {
			warningCount++
		} else {
			normalCount++
		}
	}

	return &TimelineResult{
		Events:         events,
		RolloutHistory: rollouts,
		Summary: map[string]interface{}{
			"total_events":  len(events),
			"normal_count":  normalCount,
			"warning_count": warningCount,
			"time_range": map[string]interface{}{
				"start": cutoff.UTC().Format(time.RFC3339),
				"end":   time.Now().UTC().Format(time.RFC3339),
			},
		},
	}
}

// eventTimestamp returns the most relevant timestamp for an event.
func eventTimestamp(e corev1.Event) time.Time {
	if !e.LastTimestamp.IsZero() {
		return e.LastTimestamp.Time
	}
	if !e.EventTime.IsZero() {
		return e.EventTime.Time
	}
	return e.CreationTimestamp.Time
}

// extractContainerImages returns image names from containers.
func extractContainerImages(containers []corev1.Container) []string {
	images := make([]string, 0, len(containers))
	for _, c := range containers {
		images = append(images, c.Image)
	}
	return images
}

// getTimelineEvents fetches K8s events with optional resource filter and time cutoff.
func (s *Service) getTimelineEvents(ctx context.Context, namespace, kind, name string, cutoff time.Time, limit int) ([]map[string]interface{}, error) {
	opts := metav1.ListOptions{}
	if name != "" && kind != "" {
		opts.FieldSelector = fmt.Sprintf("involvedObject.name=%s,involvedObject.kind=%s", name, kind)
	} else if name != "" {
		opts.FieldSelector = fmt.Sprintf("involvedObject.name=%s", name)
	}

	eventList, err := s.clientset.CoreV1().Events(namespace).List(ctx, opts)
	if err != nil {
		return nil, fmt.Errorf("list timeline events: %w", err)
	}

	// Filter by time and sort
	filtered := make([]corev1.Event, 0, len(eventList.Items))
	for _, e := range eventList.Items {
		ts := eventTimestamp(e)
		if !ts.Before(cutoff) {
			filtered = append(filtered, e)
		}
	}

	sort.Slice(filtered, func(i, j int) bool {
		ti := eventTimestamp(filtered[i])
		tj := eventTimestamp(filtered[j])
		return ti.After(tj)
	})

	// Apply limit
	if limit > 0 && len(filtered) > limit {
		filtered = filtered[:limit]
	}

	result := make([]map[string]interface{}, 0, len(filtered))
	for _, e := range filtered {
		ts := eventTimestamp(e)
		result = append(result, map[string]interface{}{
			"timestamp": ts.UTC().Format(time.RFC3339),
			"type":      e.Type,
			"reason":    e.Reason,
			"message":   e.Message,
			"source":    e.Source.Component,
			"resource": map[string]interface{}{
				"kind":      e.InvolvedObject.Kind,
				"name":      e.InvolvedObject.Name,
				"namespace": e.InvolvedObject.Namespace,
			},
			"involved_object": map[string]interface{}{
				"kind":      e.InvolvedObject.Kind,
				"name":      e.InvolvedObject.Name,
				"namespace": e.InvolvedObject.Namespace,
			},
			"count":      e.Count,
			"first_seen": toISO(&e.FirstTimestamp),
			"last_seen":  toISO(&e.LastTimestamp),
		})
	}
	return result, nil
}

// nilIfEmpty returns nil if string is empty, otherwise the string.
func nilIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
