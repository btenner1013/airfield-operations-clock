import type { Metadata } from "next";
import "./globals.css";
import "./weather.css";
import "./ops.css";
import "./forecast-labels.css";
export const metadata: Metadata = { title:"Airfield Operations Clock · KMEM", description:"Local and Zulu airfield operations clock with live weather." };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
