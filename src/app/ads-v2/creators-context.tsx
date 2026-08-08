"use client";

import { createContext, useContext } from "react";

// The configured creators, handed to the client from the server page.
//
// Everything that used to name specific people in the UI now reads this: the
// account dropdown, the gear panel, the colour dot on each row. Nothing about
// who you run ads for is hardcoded in a component, which is what lets someone
// else install this and see their own names.

export interface UiCreator {
  key: string;
  name: string;
}

const CreatorsContext = createContext<UiCreator[]>([]);

export function CreatorsProvider({
  creators,
  children,
}: {
  creators: UiCreator[];
  children: React.ReactNode;
}) {
  return <CreatorsContext.Provider value={creators}>{children}</CreatorsContext.Provider>;
}

export function useCreators(): UiCreator[] {
  return useContext(CreatorsContext);
}

/**
 * The dot colour class for a creator: their position in the configured list,
 * wrapped at the number of colours the stylesheet defines. Position rather than
 * name, so a creator called anything at all still gets a stable colour.
 */
export function dotClassFor(clientKey: string | null | undefined, creators: UiCreator[]): string {
  const index = creators.findIndex((c) => c.key === clientKey);
  return `c${(index < 0 ? 0 : index) % 6}`;
}
