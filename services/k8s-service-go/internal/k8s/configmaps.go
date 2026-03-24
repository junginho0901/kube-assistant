package k8s

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// GetConfigMaps lists configmaps in a namespace.
func (s *Service) GetConfigMaps(ctx context.Context, namespace string) ([]map[string]interface{}, error) {
	cmList, err := s.clientset.CoreV1().ConfigMaps(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list configmaps: %w", err)
	}

	result := make([]map[string]interface{}, 0, len(cmList.Items))
	for _, cm := range cmList.Items {
		dataKeys := make([]string, 0, len(cm.Data))
		for k := range cm.Data {
			dataKeys = append(dataKeys, k)
		}
		binaryKeys := make([]string, 0, len(cm.BinaryData))
		for k := range cm.BinaryData {
			binaryKeys = append(binaryKeys, k)
		}

		result = append(result, map[string]interface{}{
			"name":        cm.Name,
			"namespace":   cm.Namespace,
			"data_count":  len(cm.Data),
			"data_keys":   dataKeys,
			"binary_keys": binaryKeys,
			"labels":      cm.Labels,
			"created_at":  toISO(&cm.CreationTimestamp),
		})
	}
	return result, nil
}

// GetAllConfigMaps lists configmaps across all namespaces.
func (s *Service) GetAllConfigMaps(ctx context.Context) ([]map[string]interface{}, error) {
	cmList, err := s.clientset.CoreV1().ConfigMaps("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list all configmaps: %w", err)
	}

	result := make([]map[string]interface{}, 0, len(cmList.Items))
	for _, cm := range cmList.Items {
		dataKeys := make([]string, 0, len(cm.Data))
		for k := range cm.Data {
			dataKeys = append(dataKeys, k)
		}
		binaryKeys := make([]string, 0, len(cm.BinaryData))
		for k := range cm.BinaryData {
			binaryKeys = append(binaryKeys, k)
		}

		result = append(result, map[string]interface{}{
			"name":        cm.Name,
			"namespace":   cm.Namespace,
			"data_count":  len(cm.Data),
			"data_keys":   dataKeys,
			"binary_keys": binaryKeys,
			"labels":      cm.Labels,
			"created_at":  toISO(&cm.CreationTimestamp),
		})
	}
	return result, nil
}

// DescribeConfigMap returns detailed info about a configmap.
func (s *Service) DescribeConfigMap(ctx context.Context, namespace, name string) (map[string]interface{}, error) {
	cm, err := s.clientset.CoreV1().ConfigMaps(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("get configmap %s/%s: %w", namespace, name, err)
	}

	dataKeys := make([]string, 0, len(cm.Data))
	for k := range cm.Data {
		dataKeys = append(dataKeys, k)
	}
	binaryKeys := make([]string, 0, len(cm.BinaryData))
	for k := range cm.BinaryData {
		binaryKeys = append(binaryKeys, k)
	}

	// Data entries (key-value)
	dataEntries := make(map[string]string, len(cm.Data))
	for k, v := range cm.Data {
		dataEntries[k] = v
	}

	result := map[string]interface{}{
		"name":             cm.Name,
		"namespace":        cm.Namespace,
		"data_count":       len(cm.Data),
		"data_keys":        dataKeys,
		"binary_keys":      binaryKeys,
		"binary_count":     len(cm.BinaryData),
		"data":             dataEntries,
		"labels":           cm.Labels,
		"annotations":      cm.Annotations,
		"created_at":       toISO(&cm.CreationTimestamp),
		"uid":              string(cm.UID),
		"resource_version": cm.ResourceVersion,
	}

	// Events
	events, eventsErr := s.clientset.CoreV1().Events(namespace).List(ctx, metav1.ListOptions{
		FieldSelector: fmt.Sprintf("involvedObject.name=%s,involvedObject.kind=ConfigMap", name),
	})
	if eventsErr == nil {
		sortEventsByTime(events.Items)
		result["events"] = formatEventList(events.Items)
	}

	return result, nil
}

// DeleteConfigMap deletes a configmap.
func (s *Service) DeleteConfigMap(ctx context.Context, namespace, name string) error {
	return s.clientset.CoreV1().ConfigMaps(namespace).Delete(ctx, name, metav1.DeleteOptions{})
}

// GetConfigMapYAML returns a configmap as YAML.
func (s *Service) GetConfigMapYAML(ctx context.Context, namespace, name string) (string, error) {
	cacheKey := fmt.Sprintf("yaml|configmaps|%s|%s", namespace, name)

	var cached string
	if s.cache.Get(ctx, cacheKey, &cached) {
		return cached, nil
	}

	cm, err := s.clientset.CoreV1().ConfigMaps(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("get configmap %s/%s: %w", namespace, name, err)
	}

	cm.ManagedFields = nil
	data, err := json.Marshal(cm)
	if err != nil {
		return "", fmt.Errorf("marshal configmap: %w", err)
	}

	yamlStr := jsonToYAML(data)
	s.cache.Set(ctx, cacheKey, yamlStr, 10*time.Second)
	return yamlStr, nil
}

// GetSecrets lists secrets in a namespace (data values masked).
func (s *Service) GetSecrets(ctx context.Context, namespace string) ([]map[string]interface{}, error) {
	secretList, err := s.clientset.CoreV1().Secrets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list secrets: %w", err)
	}

	result := make([]map[string]interface{}, 0, len(secretList.Items))
	for _, secret := range secretList.Items {
		dataKeys := make([]string, 0, len(secret.Data))
		for k := range secret.Data {
			dataKeys = append(dataKeys, k)
		}

		result = append(result, map[string]interface{}{
			"name":       secret.Name,
			"namespace":  secret.Namespace,
			"type":       string(secret.Type),
			"data_count": len(secret.Data),
			"data_keys":  dataKeys,
			"labels":     secret.Labels,
			"created_at": toISO(&secret.CreationTimestamp),
		})
	}
	return result, nil
}

// GetSecretYAML returns a secret as YAML with data values masked.
func (s *Service) GetSecretYAML(ctx context.Context, namespace, name string) (string, error) {
	gvr := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "secrets"}
	obj, err := s.GetResource(ctx, gvr, namespace, name)
	if err != nil {
		return "", fmt.Errorf("get secret %s/%s: %w", namespace, name, err)
	}

	obj.SetManagedFields(nil)

	// Mask data values
	if data, ok := obj.Object["data"].(map[string]interface{}); ok {
		for k := range data {
			data[k] = "***"
		}
	}
	if stringData, ok := obj.Object["stringData"].(map[string]interface{}); ok {
		for k := range stringData {
			stringData[k] = "***"
		}
	}

	rawData, err := json.Marshal(obj.Object)
	if err != nil {
		return "", fmt.Errorf("marshal secret: %w", err)
	}

	return jsonToYAML(rawData), nil
}
