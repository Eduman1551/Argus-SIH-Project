import { redirect } from "next/navigation";

/** The old sign-in address; sign-in now lives at /login. */
export default function Welcome() {
  redirect("/login");
}
