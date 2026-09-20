import { ProtocolShell } from "@/components/protocol-shell";
import { DataCard, NotConnected, Section, TrustBoundary } from "@/components/protocol-ui";
import { PAVEL_NETWORK } from "@/lib/pavel/network";
import { qualificationLabel } from "@/lib/pavel/config";

export default function AppPage() {
  return <ProtocolShell><div className="route-intro"><span className="eyebrow">CONTROL PLANE / OVERVIEW</span><h2>Protocol state, without invented certainty.</h2><p>The overview combines Core and Vault reads only after a wallet and verified contract configuration are available.</p></div><div className="grid"><DataCard label="Network" value="Studionet" note={`chain ${PAVEL_NETWORK.chainId}`} /><DataCard label="Economic authority" value="Vault-led" note="Core never shadows balances" /><DataCard label="Configuration" value="Environment" note="No default addresses" /></div><TrustBoundary title="Read boundary" body={qualificationLabel()} /><NotConnected /><Section eyebrow="Lifecycle" title="How a value decision moves"><div className="steps"><div className="step"><h3>Mandate</h3><p>Principal seals bounded constitutional authority for an agent.</p></div><div className="step"><h3>Intent</h3><p>Agent freezes a recipient, amount, terms, and evidence identity.</p></div><div className="step"><h3>Authorization</h3><p>Consensus evaluates semantic compliance; deterministic fields stay frozen.</p></div><div className="step"><h3>Settlement</h3><p>Vault reserves and later requests release or refund without conflating external transfer finality.</p></div></div></Section></ProtocolShell>;
}
