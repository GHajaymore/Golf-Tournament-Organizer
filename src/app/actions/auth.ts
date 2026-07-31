"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSession, destroySession, setPreviewPlayer } from "@/lib/auth";

export async function signInAction(accountId: string) {
  await createSession(accountId);
  redirect("/dashboard");
}

export async function signOutAction() {
  await destroySession();
  redirect("/");
}

export async function setPreviewAction(previewPlayer: boolean) {
  await setPreviewPlayer(previewPlayer);
  revalidatePath("/", "layout");
}
