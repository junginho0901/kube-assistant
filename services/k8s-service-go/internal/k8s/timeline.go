package k8s

import (
	"time"

	corev1 "k8s.io/api/core/v1"
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

// nilIfEmpty returns nil if string is empty, otherwise the string.
func nilIfEmpty(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}
