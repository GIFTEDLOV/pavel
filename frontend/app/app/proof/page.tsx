"use client";

import { ProtocolShell } from "@/components/protocol-shell";
import { AddressValue, DataCard, PageHeader, Section, TrustBoundary } from "@/components/protocol-ui";
import { PAVEL_NETWORK } from "@/lib/pavel/network";
import { configuredContracts } from "@/lib/pavel/config";

export default function ProofPage() {
  const contracts = configuredContracts();
  return <ProtocolShell><PageHeader eyebrow="PROOF / DEPLOYMENT" title="A readable trail from source to state." body="PAVEL exposes the network, addresses, schemas, and accounting boundary that the application is actually using. Historical versions are never runtime fallbacks." /><Section eyebrow="ACTIVE CONFIGURATION" title="Studionet V7"><div className="grid"><DataCard label="Network" value="Studionet" note={`chain ${PAVEL_NETWORK.chainId}`} /><DataCard label="Currency" value="GEN" note="Native protocol value" /><DataCard label="Authorization" value="v2" note="12 semantic booleans" /><DataCard label="Fulfillment" value="v2" note="7 objective + 2 semantic" /></div></Section><Section title="Contracts"><div className="surface"><AddressValue label="Core" value={contracts.core} /><AddressValue label="Vault" value={contracts.vault} /><AddressValue label="RPC" value={PAVEL_NETWORK.rpcUrl} /><AddressValue label="Explorer" value={PAVEL_NETWORK.explorer} /></div></Section><TrustBoundary title="Application truth" body="The frontend does not declare a transfer paid merely because a release direction exists. Current qualified state is FULFILLED / RELEASE_PENDING with external observation unconfirmed." /></ProtocolShell>;
}
