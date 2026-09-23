import type { Metadata } from "next";
import "./globals.css";
import { PavelProvider } from "@/components/pavel-provider";

export const metadata: Metadata = { title: "PAVEL · Policy execution layer", description: "Bounded agent authority, authenticated evidence, and deterministic value settlement on GenLayer." };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body><PavelProvider>{children}</PavelProvider></body></html>; }
