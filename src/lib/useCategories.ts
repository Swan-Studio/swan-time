import { useEffect, useState } from 'react';
import { swan } from './swan';
import { CATEGORIES } from './constants';

// Category options for the pickers. These are read live from the user's own
// time-tracker board (its Category status column) so each board can define its
// own set. The bundled CATEGORIES list is the initial value (no empty flash)
// and the fallback when the board can't be read or has no labels yet.
export function useCategories(): string[] {
  const [categories, setCategories] = useState<string[]>(() => [...CATEGORIES]);
  useEffect(() => {
    swan
      .listCategories()
      .then(list => {
        if (Array.isArray(list) && list.length) setCategories(list);
      })
      .catch(() => {});
  }, []);
  return categories;
}
