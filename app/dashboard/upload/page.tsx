"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function UploadPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard/data");
  }, [router]);

  return null;
}
