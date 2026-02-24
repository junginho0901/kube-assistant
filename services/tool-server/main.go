package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

type ToolCallRequest struct {
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments"`
}

type ToolCallResponse struct {
	Content string `json:"content,omitempty"`
	Error   string `json:"error,omitempty"`
}

type ToolInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type ToolListResponse struct {
	Tools []ToolInfo `json:"tools"`
}

type ToolHandler func(ctx context.Context, args map[string]interface{}, headers http.Header) (string, error)

type ToolDefinition struct {
	Name        string
	Description string
	Handler     ToolHandler
}

var (
	kubeconfigPath   = resolveKubeconfigPath()
	tokenPassthrough = strings.EqualFold(os.Getenv("TOKEN_PASSTHROUGH"), "true")
	defaultTimeout   = 60 * time.Second
)

func main() {
	port := envOrDefault("PORT", "8086")

	toolRegistry := buildToolRegistry()

	mux := http.NewServeMux()
	mux.HandleFunc("/health", handleHealth)
	mux.HandleFunc("/tools/list", func(w http.ResponseWriter, r *http.Request) {
		handleList(w, r, toolRegistry)
	})
	mux.HandleFunc("/tools/call", func(w http.ResponseWriter, r *http.Request) {
		handleCall(w, r, toolRegistry)
	})

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	log.Printf("tool-server listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func handleList(w http.ResponseWriter, r *http.Request, tools map[string]ToolDefinition) {
	list := make([]ToolInfo, 0, len(tools))
	for _, tool := range tools {
		list = append(list, ToolInfo{Name: tool.Name, Description: tool.Description})
	}
	respondJSON(w, http.StatusOK, ToolListResponse{Tools: list})
}

func handleCall(w http.ResponseWriter, r *http.Request, tools map[string]ToolDefinition) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	decoder := json.NewDecoder(r.Body)
	decoder.UseNumber()

	var req ToolCallRequest
	if err := decoder.Decode(&req); err != nil {
		respondJSON(w, http.StatusBadRequest, ToolCallResponse{Error: "invalid json"})
		return
	}
	if req.Name == "" {
		respondJSON(w, http.StatusBadRequest, ToolCallResponse{Error: "name is required"})
		return
	}

	tool, ok := tools[req.Name]
	if !ok {
		respondJSON(w, http.StatusNotFound, ToolCallResponse{Error: "unknown tool"})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), defaultTimeout)
	defer cancel()

	output, err := tool.Handler(ctx, req.Arguments, r.Header)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errBadRequest) {
			status = http.StatusBadRequest
		}
		respondJSON(w, status, ToolCallResponse{Error: err.Error()})
		return
	}

	respondJSON(w, http.StatusOK, ToolCallResponse{Content: output})
}

func buildToolRegistry() map[string]ToolDefinition {
	registry := map[string]ToolDefinition{}

	register := func(def ToolDefinition) {
		registry[def.Name] = def
	}

	register(ToolDefinition{
		Name:        "k8s_get_resources",
		Description: "Get Kubernetes resources using kubectl",
		Handler:     handleGetResources,
	})
	register(ToolDefinition{
		Name:        "k8s_get_resource_yaml",
		Description: "Get the YAML representation of a Kubernetes resource",
		Handler:     handleGetResourceYAML,
	})
	register(ToolDefinition{
		Name:        "k8s_describe_resource",
		Description: "Describe a Kubernetes resource in detail",
		Handler:     handleDescribeResource,
	})
	register(ToolDefinition{
		Name:        "k8s_get_pod_logs",
		Description: "Get logs from a Kubernetes pod",
		Handler:     handleGetPodLogs,
	})
	register(ToolDefinition{
		Name:        "k8s_get_events",
		Description: "Get events from a Kubernetes namespace",
		Handler:     handleGetEvents,
	})
	register(ToolDefinition{
		Name:        "k8s_get_available_api_resources",
		Description: "Get available Kubernetes API resources",
		Handler:     handleGetAvailableAPIResources,
	})
	register(ToolDefinition{
		Name:        "k8s_get_cluster_configuration",
		Description: "Get cluster configuration details",
		Handler:     handleGetClusterConfiguration,
	})

	return registry
}

var errBadRequest = errors.New("bad request")

func handleGetResources(ctx context.Context, args map[string]interface{}, headers http.Header) (string, error) {
	resourceType := argString(args, "resource_type", "")
	if resourceType == "" {
		return "", wrapBadRequest("resource_type parameter is required")
	}
	resourceName := argString(args, "resource_name", "")
	namespace := argString(args, "namespace", "")
	allNamespaces := argBool(args, "all_namespaces")
	output := argString(args, "output", "wide")

	cmdArgs := []string{"get", resourceType}
	if resourceName != "" {
		cmdArgs = append(cmdArgs, resourceName)
	}

	if allNamespaces {
		cmdArgs = append(cmdArgs, "--all-namespaces")
	} else if namespace != "" {
		cmdArgs = append(cmdArgs, "-n", namespace)
	}

	if output != "" {
		cmdArgs = append(cmdArgs, "-o", output)
	} else {
		cmdArgs = append(cmdArgs, "-o", "json")
	}

	return runKubectl(ctx, headers, cmdArgs...)
}

func handleGetResourceYAML(ctx context.Context, args map[string]interface{}, headers http.Header) (string, error) {
	resourceType := argString(args, "resource_type", "")
	resourceName := argString(args, "resource_name", "")
	if resourceType == "" || resourceName == "" {
		return "", wrapBadRequest("resource_type and resource_name are required")
	}

	namespace := argString(args, "namespace", "")
	cmdArgs := []string{"get", resourceType, resourceName, "-o", "yaml"}
	if namespace != "" {
		cmdArgs = append(cmdArgs, "-n", namespace)
	}

	return runKubectl(ctx, headers, cmdArgs...)
}

func handleDescribeResource(ctx context.Context, args map[string]interface{}, headers http.Header) (string, error) {
	resourceType := argString(args, "resource_type", "")
	resourceName := argString(args, "resource_name", "")
	if resourceType == "" || resourceName == "" {
		return "", wrapBadRequest("resource_type and resource_name are required")
	}

	namespace := argString(args, "namespace", "")
	cmdArgs := []string{"describe", resourceType, resourceName}
	if namespace != "" {
		cmdArgs = append(cmdArgs, "-n", namespace)
	}

	return runKubectl(ctx, headers, cmdArgs...)
}

func handleGetPodLogs(ctx context.Context, args map[string]interface{}, headers http.Header) (string, error) {
	podName := argString(args, "pod_name", "")
	if podName == "" {
		return "", wrapBadRequest("pod_name parameter is required")
	}

	namespace := argString(args, "namespace", "default")
	container := argString(args, "container", "")
	tailLines := argInt(args, "tail_lines", 50)

	cmdArgs := []string{"logs", podName, "-n", namespace}
	if container != "" {
		cmdArgs = append(cmdArgs, "-c", container)
	}
	if tailLines > 0 {
		cmdArgs = append(cmdArgs, "--tail", fmt.Sprintf("%d", tailLines))
	}

	return runKubectl(ctx, headers, cmdArgs...)
}

func handleGetEvents(ctx context.Context, args map[string]interface{}, headers http.Header) (string, error) {
	namespace := argString(args, "namespace", "")

	cmdArgs := []string{"get", "events", "-o", "json"}
	if namespace != "" {
		cmdArgs = append(cmdArgs, "-n", namespace)
	} else {
		cmdArgs = append(cmdArgs, "--all-namespaces")
	}

	return runKubectl(ctx, headers, cmdArgs...)
}

func handleGetAvailableAPIResources(ctx context.Context, _ map[string]interface{}, headers http.Header) (string, error) {
	return runKubectl(ctx, headers, "api-resources")
}

func handleGetClusterConfiguration(ctx context.Context, _ map[string]interface{}, headers http.Header) (string, error) {
	return runKubectl(ctx, headers, "config", "view", "-o", "json")
}

func runKubectl(ctx context.Context, headers http.Header, args ...string) (string, error) {
	token, err := tokenForKubectl(headers)
	if err != nil {
		return "", err
	}

	finalArgs := make([]string, 0, len(args)+4)
	if kubeconfigPath != "" {
		finalArgs = append(finalArgs, "--kubeconfig", kubeconfigPath)
	}
	if token != "" {
		finalArgs = append(finalArgs, "--token", token)
	}
	finalArgs = append(finalArgs, args...)

	cmd := exec.CommandContext(ctx, "kubectl", finalArgs...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		errText := strings.TrimSpace(string(output))
		if errText == "" {
			errText = err.Error()
		}
		return "", fmt.Errorf("kubectl failed: %s", errText)
	}

	return string(output), nil
}

func tokenForKubectl(headers http.Header) (string, error) {
	token := extractBearerToken(headers)
	if tokenPassthrough && token == "" {
		return "", wrapBadRequest("Bearer token required when TOKEN_PASSTHROUGH is true")
	}
	if tokenPassthrough {
		return token, nil
	}
	return "", nil
}

func extractBearerToken(headers http.Header) string {
	auth := headers.Get("Authorization")
	if auth == "" {
		return ""
	}
	parts := strings.SplitN(auth, " ", 2)
	if len(parts) != 2 {
		return ""
	}
	if strings.ToLower(parts[0]) != "bearer" {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func resolveKubeconfigPath() string {
	if v := os.Getenv("KUBECONFIG_PATH"); v != "" {
		return v
	}
	if v := os.Getenv("KUBECONFIG"); v != "" {
		return v
	}
	return ""
}

func argString(args map[string]interface{}, key, def string) string {
	if args == nil {
		return def
	}
	val, ok := args[key]
	if !ok || val == nil {
		return def
	}
	switch v := val.(type) {
	case string:
		if v == "" {
			return def
		}
		return v
	default:
		return fmt.Sprint(v)
	}
}

func argBool(args map[string]interface{}, key string) bool {
	if args == nil {
		return false
	}
	val, ok := args[key]
	if !ok || val == nil {
		return false
	}
	switch v := val.(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(strings.TrimSpace(v), "true")
	case json.Number:
		return v.String() == "1"
	case float64:
		return v != 0
	case int:
		return v != 0
	default:
		return false
	}
}

func argInt(args map[string]interface{}, key string, def int) int {
	if args == nil {
		return def
	}
	val, ok := args[key]
	if !ok || val == nil {
		return def
	}
	switch v := val.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case json.Number:
		i, err := strconv.Atoi(v.String())
		if err != nil {
			return def
		}
		return i
	case string:
		i, err := strconv.Atoi(v)
		if err != nil {
			return def
		}
		return i
	default:
		return def
	}
}

func wrapBadRequest(message string) error {
	return fmt.Errorf("%w: %s", errBadRequest, message)
}

func respondJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
