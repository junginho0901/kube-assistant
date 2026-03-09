import { InfoSection, InfoRow, KeyValueTags, fmtRel, fmtTs } from './DetailCommon'

interface Props {
  name: string
  namespace?: string
  kind: string
  rawJson?: Record<string, unknown>
}

export default function NetworkInfo({ name, namespace, kind, rawJson }: Props) {
  if (kind === 'Service') return <ServiceDetail name={name} namespace={namespace} rawJson={rawJson} />
  if (kind === 'Ingress') return <IngressDetail name={name} namespace={namespace} rawJson={rawJson} />
  if (kind === 'NetworkPolicy') return <NetworkPolicyDetail name={name} namespace={namespace} rawJson={rawJson} />
  return <EndpointDetail name={name} namespace={namespace} kind={kind} rawJson={rawJson} />
}

function ServiceDetail({ name, namespace, rawJson }: { name: string; namespace?: string; rawJson?: Record<string, unknown> }) {
  const meta = (rawJson?.metadata ?? {}) as Record<string, unknown>
  const spec = (rawJson?.spec ?? {}) as Record<string, unknown>
  const status = (rawJson?.status ?? {}) as Record<string, unknown>
  const labels = (meta.labels ?? {}) as Record<string, string>
  const selector = (spec.selector ?? {}) as Record<string, string>
  const ports = (spec.ports ?? []) as any[]
  const externalIPs = (spec.externalIPs ?? []) as string[]
  const lbIngress = ((status.loadBalancer as any)?.ingress ?? []) as any[]

  return (
    <>
      <InfoSection title="Service Info">
        <div className="space-y-2">
          <InfoRow label="Name" value={name} />
          {namespace && <InfoRow label="Namespace" value={namespace} />}
          <InfoRow label="Type" value={String(spec.type ?? 'ClusterIP')} />
          <InfoRow label="Cluster IP" value={String(spec.clusterIP ?? '-')} />
          {externalIPs.length > 0 && <InfoRow label="External IPs" value={externalIPs.join(', ')} />}
          {lbIngress.length > 0 && <InfoRow label="Load Balancer" value={lbIngress.map((i: any) => i.ip || i.hostname).join(', ')} />}
          <InfoRow label="Session Affinity" value={String(spec.sessionAffinity ?? 'None')} />
          <InfoRow label="Created" value={meta.creationTimestamp ? `${fmtTs(meta.creationTimestamp as string)} (${fmtRel(meta.creationTimestamp as string)})` : '-'} />
        </div>
      </InfoSection>

      {Object.keys(selector).length > 0 && (
        <InfoSection title="Selector">
          <KeyValueTags data={selector} />
        </InfoSection>
      )}

      {ports.length > 0 && (
        <InfoSection title="Ports">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[400px]">
              <thead className="text-slate-400"><tr><th className="text-left py-1">Name</th><th className="text-left py-1">Port</th><th className="text-left py-1">Target</th><th className="text-left py-1">Protocol</th>{spec.type === 'NodePort' && <th className="text-left py-1">NodePort</th>}</tr></thead>
              <tbody className="divide-y divide-slate-800">
                {ports.map((p: any, i: number) => (
                  <tr key={i} className="text-slate-200">
                    <td className="py-1 pr-2">{p.name || '-'}</td>
                    <td className="py-1 pr-2">{p.port}</td>
                    <td className="py-1 pr-2">{p.targetPort ?? '-'}</td>
                    <td className="py-1 pr-2">{p.protocol || 'TCP'}</td>
                    {spec.type === 'NodePort' && <td className="py-1 pr-2">{p.nodePort ?? '-'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </InfoSection>
      )}

      {Object.keys(labels).length > 0 && <InfoSection title="Labels"><KeyValueTags data={labels} /></InfoSection>}
    </>
  )
}

function IngressDetail({ name, namespace, rawJson }: { name: string; namespace?: string; rawJson?: Record<string, unknown> }) {
  const meta = (rawJson?.metadata ?? {}) as Record<string, unknown>
  const spec = (rawJson?.spec ?? {}) as Record<string, unknown>
  const labels = (meta.labels ?? {}) as Record<string, string>
  const rules = (spec.rules ?? []) as any[]
  const tls = (spec.tls ?? []) as any[]
  const defaultBackend = spec.defaultBackend as any

  return (
    <>
      <InfoSection title="Ingress Info">
        <div className="space-y-2">
          <InfoRow label="Name" value={name} />
          {namespace && <InfoRow label="Namespace" value={namespace} />}
          {spec.ingressClassName && <InfoRow label="Ingress Class" value={String(spec.ingressClassName)} />}
          {defaultBackend && (
            <InfoRow label="Default Backend" value={
              defaultBackend.service ? `${defaultBackend.service.name}:${defaultBackend.service.port?.number || defaultBackend.service.port?.name || ''}` : '-'
            } />
          )}
          <InfoRow label="Created" value={meta.creationTimestamp ? `${fmtTs(meta.creationTimestamp as string)} (${fmtRel(meta.creationTimestamp as string)})` : '-'} />
        </div>
      </InfoSection>

      {tls.length > 0 && (
        <InfoSection title="TLS">
          <div className="space-y-1 text-xs">
            {tls.map((t: any, i: number) => (
              <div key={i} className="text-slate-200">
                <span className="text-slate-400">Secret:</span> {t.secretName || '-'} <span className="text-slate-400">→</span> {(t.hosts || []).join(', ')}
              </div>
            ))}
          </div>
        </InfoSection>
      )}

      {rules.length > 0 && (
        <InfoSection title="Rules">
          <div className="space-y-3">
            {rules.map((rule: any, i: number) => (
              <div key={i} className="rounded border border-slate-800 p-3">
                <p className="text-xs text-white font-medium mb-2">{rule.host || '*'}</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-slate-400"><tr><th className="text-left py-1">Path</th><th className="text-left py-1">Type</th><th className="text-left py-1">Backend</th></tr></thead>
                    <tbody className="divide-y divide-slate-800">
                      {(rule.http?.paths || []).map((path: any, pi: number) => (
                        <tr key={pi} className="text-slate-200">
                          <td className="py-1 pr-2 font-mono">{path.path || '/'}</td>
                          <td className="py-1 pr-2">{path.pathType || 'Prefix'}</td>
                          <td className="py-1 pr-2">{path.backend?.service?.name}:{path.backend?.service?.port?.number || path.backend?.service?.port?.name || ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </InfoSection>
      )}

      {Object.keys(labels).length > 0 && <InfoSection title="Labels"><KeyValueTags data={labels} /></InfoSection>}
    </>
  )
}

function NetworkPolicyDetail({ name, namespace, rawJson }: { name: string; namespace?: string; rawJson?: Record<string, unknown> }) {
  const meta = (rawJson?.metadata ?? {}) as Record<string, unknown>
  const spec = (rawJson?.spec ?? {}) as Record<string, unknown>
  const labels = (meta.labels ?? {}) as Record<string, string>
  const podSelector = (spec.podSelector as any)?.matchLabels as Record<string, string> | undefined
  const ingress = (spec.ingress ?? []) as any[]
  const egress = (spec.egress ?? []) as any[]
  const policyTypes = (spec.policyTypes ?? []) as string[]

  const renderPeer = (peer: any) => {
    const parts: string[] = []
    if (peer.ipBlock) parts.push(`CIDR: ${peer.ipBlock.cidr}${peer.ipBlock.except ? ` (except ${peer.ipBlock.except.join(', ')})` : ''}`)
    if (peer.namespaceSelector?.matchLabels) parts.push(`ns: ${Object.entries(peer.namespaceSelector.matchLabels).map(([k, v]) => `${k}=${v}`).join(',')}`)
    if (peer.podSelector?.matchLabels) parts.push(`pod: ${Object.entries(peer.podSelector.matchLabels).map(([k, v]) => `${k}=${v}`).join(',')}`)
    return parts.join(' | ') || '*'
  }

  return (
    <>
      <InfoSection title="NetworkPolicy Info">
        <div className="space-y-2">
          <InfoRow label="Name" value={name} />
          {namespace && <InfoRow label="Namespace" value={namespace} />}
          <InfoRow label="Policy Types" value={policyTypes.join(', ') || '-'} />
          <InfoRow label="Created" value={meta.creationTimestamp ? `${fmtTs(meta.creationTimestamp as string)} (${fmtRel(meta.creationTimestamp as string)})` : '-'} />
        </div>
      </InfoSection>

      {podSelector && Object.keys(podSelector).length > 0 && (
        <InfoSection title="Pod Selector">
          <KeyValueTags data={podSelector} />
        </InfoSection>
      )}

      {ingress.length > 0 && (
        <InfoSection title="Ingress Rules">
          <div className="space-y-2 text-xs">
            {ingress.map((rule: any, i: number) => (
              <div key={i} className="rounded border border-slate-800 p-2">
                {rule.ports?.length > 0 && <div className="text-slate-400">Ports: {rule.ports.map((p: any) => `${p.port}/${p.protocol || 'TCP'}`).join(', ')}</div>}
                <div className="text-slate-200">From: {(rule.from || [{ ipBlock: { cidr: '0.0.0.0/0' } }]).map(renderPeer).join(' ; ')}</div>
              </div>
            ))}
          </div>
        </InfoSection>
      )}

      {egress.length > 0 && (
        <InfoSection title="Egress Rules">
          <div className="space-y-2 text-xs">
            {egress.map((rule: any, i: number) => (
              <div key={i} className="rounded border border-slate-800 p-2">
                {rule.ports?.length > 0 && <div className="text-slate-400">Ports: {rule.ports.map((p: any) => `${p.port}/${p.protocol || 'TCP'}`).join(', ')}</div>}
                <div className="text-slate-200">To: {(rule.to || [{ ipBlock: { cidr: '0.0.0.0/0' } }]).map(renderPeer).join(' ; ')}</div>
              </div>
            ))}
          </div>
        </InfoSection>
      )}

      {Object.keys(labels).length > 0 && <InfoSection title="Labels"><KeyValueTags data={labels} /></InfoSection>}
    </>
  )
}

function EndpointDetail({ name, namespace, kind, rawJson }: { name: string; namespace?: string; kind: string; rawJson?: Record<string, unknown> }) {
  const meta = (rawJson?.metadata ?? {}) as Record<string, unknown>
  const labels = (meta.labels ?? {}) as Record<string, string>
  const subsets = (rawJson?.subsets ?? []) as any[]
  const endpoints = (rawJson?.endpoints ?? []) as any[]

  return (
    <>
      <InfoSection title={`${kind} Info`}>
        <div className="space-y-2">
          <InfoRow label="Kind" value={kind} />
          <InfoRow label="Name" value={name} />
          {namespace && <InfoRow label="Namespace" value={namespace} />}
          <InfoRow label="Created" value={meta.creationTimestamp ? `${fmtTs(meta.creationTimestamp as string)} (${fmtRel(meta.creationTimestamp as string)})` : '-'} />
        </div>
      </InfoSection>

      {subsets.length > 0 && (
        <InfoSection title="Subsets">
          <div className="space-y-2 text-xs">
            {subsets.map((s: any, i: number) => (
              <div key={i} className="rounded border border-slate-800 p-2">
                <div className="text-slate-200">Addresses: {(s.addresses || []).map((a: any) => a.ip).join(', ') || '(none)'}</div>
                <div className="text-slate-400">Ports: {(s.ports || []).map((p: any) => `${p.name || ''}:${p.port}/${p.protocol || 'TCP'}`).join(', ') || '(none)'}</div>
              </div>
            ))}
          </div>
        </InfoSection>
      )}

      {endpoints.length > 0 && (
        <InfoSection title="Endpoints">
          <div className="space-y-2 text-xs">
            {endpoints.map((ep: any, i: number) => (
              <div key={i} className="rounded border border-slate-800 p-2">
                <div className="text-slate-200">Addresses: {(ep.addresses || []).join(', ')}</div>
                <div className="text-slate-400">Conditions: ready={String(ep.conditions?.ready ?? '-')}</div>
              </div>
            ))}
          </div>
        </InfoSection>
      )}

      {Object.keys(labels).length > 0 && <InfoSection title="Labels"><KeyValueTags data={labels} /></InfoSection>}
    </>
  )
}
