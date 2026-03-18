package k8ssetup

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// getClients returns K8s clientset using in-cluster or fallback kubeconfig.
func getClients() (*kubernetes.Clientset, error) {
	cfg, err := rest.InClusterConfig()
	if err != nil {
		cfg, err = clientcmd.BuildConfigFromFlags("", clientcmd.RecommendedHomeFile)
		if err != nil {
			return nil, fmt.Errorf("k8s config: %w", err)
		}
	}
	return kubernetes.NewForConfig(cfg)
}

// UpsertKubeconfigSecret creates or updates a Secret containing kubeconfig.
func UpsertKubeconfigSecret(ctx context.Context, namespace, name, kubeconfigText string) error {
	client, err := getClients()
	if err != nil {
		return err
	}

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
		},
		Type: corev1.SecretTypeOpaque,
		StringData: map[string]string{
			"kubeconfig.yaml": kubeconfigText,
		},
	}

	existing, err := client.CoreV1().Secrets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err == nil && existing != nil {
		secret.ResourceVersion = existing.ResourceVersion
		_, err = client.CoreV1().Secrets(namespace).Update(ctx, secret, metav1.UpdateOptions{})
	} else {
		_, err = client.CoreV1().Secrets(namespace).Create(ctx, secret, metav1.CreateOptions{})
	}
	return err
}

// PatchConfigMap patches a ConfigMap's data field.
func PatchConfigMap(ctx context.Context, namespace, name string, data map[string]string) error {
	client, err := getClients()
	if err != nil {
		return err
	}

	// Build JSON patch for data fields
	patchParts := make([]string, 0, len(data))
	for k, v := range data {
		patchParts = append(patchParts, fmt.Sprintf(`"%s":"%s"`, k, v))
	}
	patchJSON := fmt.Sprintf(`{"data":{%s}}`, strings.Join(patchParts, ","))

	_, err = client.CoreV1().ConfigMaps(namespace).Patch(
		ctx, name, types.MergePatchType, []byte(patchJSON), metav1.PatchOptions{},
	)
	return err
}

// RestartDeployment triggers a rollout restart via annotation update.
func RestartDeployment(ctx context.Context, namespace, name string) error {
	client, err := getClients()
	if err != nil {
		return err
	}

	patchJSON := fmt.Sprintf(
		`{"spec":{"template":{"metadata":{"annotations":{"kubectl.kubernetes.io/restartedAt":"%s"}}}}}`,
		time.Now().UTC().Format(time.RFC3339Nano),
	)

	_, err = client.AppsV1().Deployments(namespace).Patch(
		ctx, name, types.MergePatchType, []byte(patchJSON), metav1.PatchOptions{},
	)
	return err
}

// ValidateKubeconfigConnection tests connectivity using provided kubeconfig bytes.
func ValidateKubeconfigConnection(kubeconfigBytes []byte, timeout int) error {
	cfg, err := clientcmd.RESTConfigFromKubeConfig(kubeconfigBytes)
	if err != nil {
		return fmt.Errorf("invalid kubeconfig: %w", err)
	}
	cfg.Timeout = time.Duration(timeout) * time.Second

	client, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return fmt.Errorf("create client: %w", err)
	}

	// Call /healthz
	body, err := client.Discovery().RESTClient().Get().AbsPath("/healthz").DoRaw(ctx_bg())
	if err != nil {
		return fmt.Errorf("connection failed: %w", err)
	}

	bodyStr := strings.TrimSpace(strings.ToLower(string(body)))
	if bodyStr != "ok" && !strings.Contains(bodyStr, "healthy") {
		return fmt.Errorf("cluster unhealthy: %s", string(body))
	}
	return nil
}

func ctx_bg() context.Context {
	return context.Background()
}

// CheckK8sServiceHealth calls k8s-service health endpoint.
func CheckK8sServiceHealth(url string, timeout int) (string, string) {
	client := &http.Client{Timeout: time.Duration(timeout) * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return "unknown", err.Error()
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		return "connected", ""
	}
	return "connecting", fmt.Sprintf("status %d", resp.StatusCode)
}

// CheckRolloutStatus checks deployment readiness.
func CheckRolloutStatus(ctx context.Context, namespace string, deploymentNames []string) map[string]interface{} {
	client, err := getClients()
	if err != nil {
		result := map[string]interface{}{"ready": false, "deployments": map[string]interface{}{}}
		return result
	}

	allReady := true
	deployments := map[string]interface{}{}

	for _, name := range deploymentNames {
		dep, err := client.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			errMsg := err.Error()
			if len(errMsg) > 100 {
				errMsg = errMsg[:100]
			}
			deployments[name] = map[string]interface{}{
				"ready": false, "error": errMsg,
			}
			allReady = false
			continue
		}

		replicas := int32(1)
		if dep.Spec.Replicas != nil {
			replicas = *dep.Spec.Replicas
		}

		ready := dep.Status.ObservedGeneration >= dep.Generation &&
			dep.Status.UpdatedReplicas >= replicas &&
			dep.Status.ReadyReplicas >= replicas &&
			dep.Status.AvailableReplicas >= replicas

		var restartAt *string
		if ann := dep.Spec.Template.Annotations; ann != nil {
			if v, ok := ann["kubectl.kubernetes.io/restartedAt"]; ok {
				restartAt = &v
			}
		}

		if !ready {
			allReady = false
		}

		deployments[name] = map[string]interface{}{
			"ready":          ready,
			"replicas":       replicas,
			"updated":        dep.Status.UpdatedReplicas,
			"ready_replicas": dep.Status.ReadyReplicas,
			"available":      dep.Status.AvailableReplicas,
			"restart_at":     restartAt,
		}
	}

	return map[string]interface{}{
		"ready":       allReady,
		"deployments": deployments,
	}
}
