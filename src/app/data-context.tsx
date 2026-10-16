import { createContext, useContext } from 'react';
import type { DataProviders } from '../data/types';

export const DataContext = createContext<DataProviders | null>(null);

export function useData(): DataProviders {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('DataContext missing');
  return ctx;
}
