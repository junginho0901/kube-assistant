# 개발자 문서 (내부 유지보수용)

## 컨트롤러 운영 옵션
- **Leader Election**: 기본 활성화. `LEADER_ELECTION=false`로 끌 수 있습니다.
- **Leader Election Namespace**: `LEADER_ELECTION_NAMESPACE` (기본: `WATCH_NAMESPACE`)
- **Metrics**: `METRICS_ADDR`로 제어 (`:8080` 활성, `0` 비활성)

## 컨트롤러 메트릭
- `kube_assistant_model_config_controller_sync_total{status,provider}`
- `kube_assistant_model_config_controller_secret_hash_change_total{provider}`

## 컨트롤러 테스트
```bash
cd services/model-config-controller-go
go test ./internal/controller -v
```

또는 스크립트로 실행:
```bash
scripts/test-controller.sh
```

## ClusterView Pod Watch (SSE)
- UI는 `EventSource`로 Pod watch 스트림을 구독합니다.
- 엔드포인트(네임스페이스): `/api/v1/cluster/namespaces/{namespace}/pods/watch`
- 엔드포인트(전체): `/api/v1/cluster/pods/watch`
- 인증은 로그인 시 발급되는 HttpOnly 쿠키(`kube-assistant.token`)를 사용합니다.
