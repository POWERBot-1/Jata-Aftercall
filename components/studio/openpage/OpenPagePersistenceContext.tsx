"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type OpenPagePersistenceValue = {
  websiteId: string;
  businessId: string;
  draftVersion: number;
  setDraftVersion: (version: number) => void;
  publishedVersion: number;
  setPublishedVersion: (version: number) => void;
  websiteStatus: string;
  setWebsiteStatus: (status: string) => void;
  isDirty: boolean;
  setIsDirty: (dirty: boolean) => void;
  isSaving: boolean;
  setIsSaving: (saving: boolean) => void;
  ready: boolean;
};

const OpenPagePersistenceContext = createContext<OpenPagePersistenceValue | null>(null);

export function OpenPagePersistenceProvider({
  websiteId,
  businessId,
  initialDraftVersion,
  initialPublishedVersion,
  initialWebsiteStatus,
  ready,
  children,
}: {
  websiteId: string;
  businessId: string;
  initialDraftVersion: number;
  initialPublishedVersion: number;
  initialWebsiteStatus: string;
  ready: boolean;
  children: ReactNode;
}) {
  const [draftVersion, setDraftVersion] = useState(initialDraftVersion);
  const [publishedVersion, setPublishedVersion] = useState(initialPublishedVersion);
  const [websiteStatus, setWebsiteStatus] = useState(initialWebsiteStatus);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  return (
    <OpenPagePersistenceContext.Provider value={{
      websiteId, businessId, draftVersion, setDraftVersion, publishedVersion, setPublishedVersion,
      websiteStatus, setWebsiteStatus, isDirty, setIsDirty, isSaving, setIsSaving, ready,
    }}>
      {children}
    </OpenPagePersistenceContext.Provider>
  );
}

export function useOpenPagePersistence() {
  const value = useContext(OpenPagePersistenceContext);
  if (!value) throw new Error("OpenPage editor must be mounted inside its JATA persistence provider.");
  return value;
}
