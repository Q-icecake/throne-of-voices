import type { NetworkMode, NetworkRoute, NetworkError } from './contracts.ts';
export const NETWORK_MODE_LABELS: Record<NetworkMode, string> = { auto: '자동', proxy: 'VPN·프록시', direct: '직접 연결' };
export const NETWORK_ROUTE_LABELS: Record<NetworkRoute, string> = {
  direct: '직접 연결', 'env-proxy': '환경변수 프록시', 'system-proxy': '시스템 프록시', 'manual-proxy': '입력 프록시',
};
/** Fixed text only: never interpolate transport errors or proxy addresses. */
export function networkAdvice(route: NetworkRoute, error?: NetworkError | null): string {
  if (!error) return '';
  const problem = error.proxyRefused ? '프록시 포트 연결 거부(VPN 꺼짐·프록시 미실행 가능)'
    : error.code === 'PROXY_NOT_CONFIGURED' ? '프록시를 찾지 못함'
    : error.code === 'PROXY_CONFIG_INVALID' ? '프록시 설정 형식 오류' : '연결 실패';
  return `현재 경로: ${NETWORK_ROUTE_LABELS[route]} → ${problem}. VPN을 껐다면 직접 연결, 켰다면 프록시 주소 확인 후 다시 시험하세요.`;
}
