import type { Metadata } from "next";
import "./globals.css";
import "./weather.css";
import "./ops.css";
import "./forecast-labels.css";
import "./motion-v2.css";
import "./layout-tuning.css";
import "./weather-tuning-v3.css";
export const metadata: Metadata = { title:"Airfield Operations Clock · KMEM", description:"Local and Zulu airfield operations clock with live weather." };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
