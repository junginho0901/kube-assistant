# detect_response_language / build_language_directive 회귀 테스트.
#
# 핵심 회귀 방지: K8s 리소스 이름 (영문+숫자+하이픈) 이 섞인 한국어 입력에서
# Korean 으로 정확히 판정해야 한다 — 사용자 보고 사례 (2026-05-04):
#   "default 의 nfs-client-provisioner-57c566d9b4-pkxgj pod 상태와
#    exec-test-pod 상태 알려줘" → 기존 heuristic 은 English 오판,
#   새 heuristic 은 Korean 정상 판정.

from app.services.ai.language import detect_response_language, build_language_directive


def test_empty_returns_english():
    assert detect_response_language("") == "English"
    assert detect_response_language("   ") == "English"
    assert detect_response_language(None) == "English"  # type: ignore[arg-type]


def test_pure_korean_returns_korean():
    assert detect_response_language("안녕하세요") == "Korean"
    assert detect_response_language("파드 목록 보여줘") == "Korean"


def test_pure_english_returns_english():
    assert detect_response_language("show me pods") == "English"
    assert detect_response_language("delete pod foo from default namespace") == "English"


def test_korean_with_k8s_resource_names_returns_korean():
    """회귀 핵심 케이스 — 한국어 의도가 K8s 리소스 이름 (영문) 에 묻혀 영어로
    오판되지 않아야 한다 (이전 버그 재현 방지)
    """
    msg = (
        "default 의 nfs-client-provisioner-57c566d9b4-pkxgj pod 상태와 "
        "exec-test-pod 상태 알려줘"
    )
    assert detect_response_language(msg) == "Korean"


def test_korean_with_kubectl_command_returns_korean():
    assert detect_response_language("kubectl get pods 결과 분석해줘") == "Korean"


def test_korean_jamo_returns_korean():
    """한글 자모 (초성/중성/종성) 만 있어도 Korean"""
    assert detect_response_language("ㄱㄴㄷ") == "Korean"


def test_symbols_only_returns_english():
    assert detect_response_language("!@#$%") == "English"
    assert detect_response_language("123 456") == "English"


def test_build_directive_includes_detected_lang():
    msg_ko = "default 의 pod 상태 알려줘"
    msg_en = "list pods in default"

    d_ko = build_language_directive(msg_ko)
    d_en = build_language_directive(msg_en)

    assert "Korean" in d_ko
    assert "English" not in d_ko or d_ko.count("Korean") >= d_ko.count("English")
    assert "English" in d_en
    assert "LANGUAGE OVERRIDE" in d_ko
    assert "LANGUAGE OVERRIDE" in d_en


def test_build_directive_keeps_resource_identifier_clause():
    """LLM 이 pod name / kubectl 명령어를 번역하지 않도록 하는 안전 장치"""
    d = build_language_directive("test")
    assert "Kubernetes resource identifiers verbatim" in d
