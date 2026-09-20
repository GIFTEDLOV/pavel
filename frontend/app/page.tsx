import Link from "next/link";

export default function Home() {
  return <main className="landing"><span className="eyebrow">PAVEL / POLICY-GOVERNED VALUE EXECUTION</span><h1>Authority that can be audited. Value that can be accounted for.</h1><p className="landing-lede">PAVEL is constitutional authorization, custody, fulfillment, and dispute infrastructure for autonomous agents.</p><div className="callout"><strong>Protocol boundary</strong><p>Mandates freeze authority, Core records semantic decisions, and Vault alone accounts for GEN. An authorization is never presented as a payment.</p></div><div className="landing-actions"><Link href="/app" className="button-link">Open control plane</Link><Link href="/app/proof" className="text-link">Inspect proof model</Link></div></main>;
}
