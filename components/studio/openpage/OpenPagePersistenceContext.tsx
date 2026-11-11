"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

type OpenPagePersistenceValue = {
  websiteId: string;
  draftVersion: number;
  setDraftVersion: (version: number) => void;
  ready: boolean;
};

const OpenPagePersistenceContext = createContext<OpenPagePersistenceValue | null>(null);

export function OpenPagePersistenceProvider({
  websiteId,
  initialDraftVersion,
  ready,
  children,
}: {
  websiteId: string;
  initialDraftVersion: number;
  ready: boolean;
  children: ReactNode;
}) {
  const [draftVersion, setDraftVersion] = useState(initialDraftVersion);
  return (
    <OpenPagePersistenceContext.Provider value={{ websiteId, draftVersion, setDraftVersion, ready }}>
      {children}
    </OpenPagePersistenceContext.Provider>
  );
}

export function useOpenPagePersistence() {
  const value = useContext(OpenPagePersistenceContext);
  if (!value) throw new Error("OpenPage editor must be mounted inside its JATA persistence provider.");
  return value;
}
