import { redirect } from "next/navigation";

// There is exactly one page in this app. The root just points at it.
export default function Home() {
  redirect("/ads-v2");
}
