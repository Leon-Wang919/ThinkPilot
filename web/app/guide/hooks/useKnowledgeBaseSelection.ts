import { useState, useCallback } from "react";
import { apiUrl } from "@/lib/api";
import { useGlobal } from "@/context/GlobalContext";
import { GuideMode, KnowledgeBaseOption } from "../types";

export function useKnowledgeBaseSelection() {
  const { currentSubject } = useGlobal();
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseOption[]>([]);
  const [selectedKb, setSelectedKb] = useState("");
  const [mode, setMode] = useState<GuideMode>("topic");
  const [topic, setTopic] = useState("");
  const [loadingKnowledgeBases, setLoadingKnowledgeBases] = useState(true);

  const fetchKnowledgeBases = useCallback(async () => {
    setLoadingKnowledgeBases(true);
    try {
      const params = new URLSearchParams({ subject: currentSubject });
      const res = await fetch(apiUrl(`/api/v1/knowledge/list?${params.toString()}`));
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setKnowledgeBases(list);

      const readyKb =
        list.find(
          (item: KnowledgeBaseOption) => item.statistics?.status === "ready",
        ) || list.find((item: KnowledgeBaseOption) => item.is_default) || list[0];

      if (readyKb) {
        setSelectedKb((prev) =>
          list.some((item: KnowledgeBaseOption) => item.name === prev) ? prev : readyKb.name,
        );
      } else {
        setSelectedKb("");
      }
    } catch (err) {
      console.error("Failed to fetch knowledge bases:", err);
      setKnowledgeBases([]);
    } finally {
      setLoadingKnowledgeBases(false);
    }
  }, [currentSubject]);

  return {
    knowledgeBases,
    selectedKb,
    mode,
    topic,
    loadingKnowledgeBases,
    fetchKnowledgeBases,
    setSelectedKb,
    setMode,
    setTopic,
  };
}
