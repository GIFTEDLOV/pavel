import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "PAVEL Protocol", description: "Policy-governed Autonomous Value Execution Layer" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
