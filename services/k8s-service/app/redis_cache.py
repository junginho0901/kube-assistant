"""
Redis 캐싱 유틸리티
"""
import json
import redis
from typing import Optional, Any
from app.config import settings


class RedisCache:
    """Redis 캐시 관리 클래스"""
    
    def __init__(self):
        """Redis 클라이언트 초기화"""
        try:
            self.redis_client = redis.Redis(
                host=settings.REDIS_HOST,
                port=settings.REDIS_PORT,
                db=settings.REDIS_DB,
                decode_responses=True,  # 자동으로 문자열 디코딩
                socket_connect_timeout=5,
                socket_timeout=5
            )
            # 연결 테스트
            self.redis_client.ping()
            self.enabled = True
            print(f"✅ Redis connected: {settings.REDIS_HOST}:{settings.REDIS_PORT}")
        except Exception as e:
            print(f"⚠️  Redis connection failed: {e}")
            print("📝 Fallback to in-memory cache")
            self.redis_client = None
            self.enabled = False
            # Fallback: 인메모리 캐시
            self._memory_cache = {}
    
    def get(self, key: str) -> Optional[Any]:
        """
        캐시에서 데이터 가져오기
        
        Args:
            key: 캐시 키
            
        Returns:
            캐시된 데이터 (없으면 None)
        """
        try:
            if self.enabled and self.redis_client:
                cached = self.redis_client.get(key)
                if cached:
                    return json.loads(cached)
            else:
                # Fallback: 인메모리 캐시
                from time import time
                if key in self._memory_cache:
                    data, timestamp, ttl = self._memory_cache[key]
                    if time() - timestamp < ttl:
                        return data
                    else:
                        del self._memory_cache[key]
            return None
        except Exception as e:
            print(f"❌ Redis get error for key '{key}': {e}")
            return None
    
    def set(self, key: str, value: Any, ttl: int = 30) -> bool:
        """
        캐시에 데이터 저장
        
        Args:
            key: 캐시 키
            value: 저장할 데이터
            ttl: TTL (초 단위)
            
        Returns:
            성공 여부
        """
        try:
            if self.enabled and self.redis_client:
                serialized = json.dumps(value, ensure_ascii=False, default=str)
                self.redis_client.setex(key, ttl, serialized)
                return True
            else:
                # Fallback: 인메모리 캐시
                from time import time
                self._memory_cache[key] = (value, time(), ttl)
                return True
        except Exception as e:
            print(f"❌ Redis set error for key '{key}': {e}")
            return False
    
    def delete(self, key: str) -> bool:
        """
        캐시에서 데이터 삭제
        
        Args:
            key: 캐시 키
            
        Returns:
            성공 여부
        """
        try:
            if self.enabled and self.redis_client:
                self.redis_client.delete(key)
                return True
            else:
                # Fallback: 인메모리 캐시
                if key in self._memory_cache:
                    del self._memory_cache[key]
                return True
        except Exception as e:
            print(f"❌ Redis delete error for key '{key}': {e}")
            return False
    
    def delete_pattern(self, pattern: str) -> int:
        """
        패턴에 맞는 모든 키 삭제
        
        Args:
            pattern: 키 패턴 (예: "namespaces:*")
            
        Returns:
            삭제된 키 개수
        """
        try:
            if self.enabled and self.redis_client:
                keys = self.redis_client.keys(pattern)
                if keys:
                    return self.redis_client.delete(*keys)
                return 0
            else:
                # Fallback: 인메모리 캐시
                count = 0
                keys_to_delete = [k for k in self._memory_cache.keys() if pattern.replace('*', '') in k]
                for key in keys_to_delete:
                    del self._memory_cache[key]
                    count += 1
                return count
        except Exception as e:
            print(f"❌ Redis delete_pattern error for pattern '{pattern}': {e}")
            return 0
    
    def flush_all(self) -> bool:
        """
        모든 캐시 삭제
        
        Returns:
            성공 여부
        """
        try:
            if self.enabled and self.redis_client:
                self.redis_client.flushdb()
                return True
            else:
                # Fallback: 인메모리 캐시
                self._memory_cache.clear()
                return True
        except Exception as e:
            print(f"❌ Redis flush_all error: {e}")
            return False


# 전역 Redis 캐시 인스턴스
redis_cache = RedisCache()
