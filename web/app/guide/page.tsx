import { redirect } from "next/navigation";

export default function GuideCompatPage() {
  redirect("/teacher?mode=explain-first");
}
