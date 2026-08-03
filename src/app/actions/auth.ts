"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSession, destroySession, setPreviewRole } from "@/lib/auth";

export async function signInAction(accountId: string) {
  await createSession(accountId);
  redirect("/dashboard");
}

export async function signOutAction() {
  await destroySession();
  redirect("/");
}

export async function setPreviewAction(previewRole: string) {
  await setPreviewRole(previewRole);
  revalidatePath("/", "layout");
}
