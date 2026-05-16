// ─── Guest Hub Menu Panel ────────────────────────────────────────────────────
// 2-panel menu editor: category list (left) | category detail / forms (right).
// Menu changes take effect immediately — no publish step required.
//
// ISOLATION: no reservation, waitlist, floor, or SSE imports.

import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../../api';
import ImageUploadField from '../../components/ImageUploadField';

// ── Local types (mirror backend DTOs) ────────────────────────────────────────

interface DishDto {
  id: string;
  categoryId: string;
  name: string;
  subtitle: string | null;
  description: string | null;
  price: string | null;
  tag: string | null;
  dietaryTags: string[];
  availability: string;
  isFeatured: boolean;
  featuredRank: number | null;
  sortOrder: number;
  imageUrl: string | null;
  gradient: string | null;
  isActive: boolean;
  isHidden: boolean;
}

interface CategoryDto {
  id: string;
  menuId: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  isHidden: boolean;
  dishes: DishDto[];
}

interface MenuTree {
  menus: Array<{
    id: string;
    name: string;
    sortOrder: number;
    isActive: boolean;
    categories: CategoryDto[];
  }>;
}

type PanelView =
  | { kind: 'empty' }
  | { kind: 'cat-dishes'; catId: string }
  | { kind: 'new-cat' }
  | { kind: 'edit-cat'; catId: string }
  | { kind: 'new-dish'; catId: string }
  | { kind: 'edit-dish'; catId: string; dishId: string };

type CatForm = { name: string; description: string };

type DishForm = {
  name: string;
  subtitle: string;
  description: string;
  price: string;
  tag: string;
  dietaryTags: string;
  availability: string;
  isFeatured: boolean;
  imageUrl: string;
  isHidden: boolean;
};

const AVAILABILITY_OPTIONS = [
  { value: 'AVAILABLE',      label: 'Available' },
  { value: 'SOLD_OUT',       label: 'Sold out' },
  { value: 'SEASONAL',       label: 'Seasonal' },
  { value: 'BREAKFAST_ONLY', label: 'Breakfast only' },
  { value: 'DINNER_ONLY',    label: 'Dinner only' },
];

const EMPTY_CAT: CatForm  = { name: '', description: '' };
const EMPTY_DISH: DishForm = {
  name: '', subtitle: '', description: '', price: '',
  tag: '', dietaryTags: '', availability: 'AVAILABLE',
  isFeatured: false, imageUrl: '', isHidden: false,
};

// ── Shared UI primitives ──────────────────────────────────────────────────────

function Field({ label, hint, error, children }: {
  label: string; hint?: string; error?: string; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs text-iron-muted mb-1">{label}</label>
      {children}
      {hint  && !error && <p className="text-xs text-iron-muted/60 mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
}

function Inp(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green ${props.className ?? ''}`}
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green resize-none ${props.className ?? ''}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full bg-iron-bg border border-iron-border rounded px-3 py-2 text-iron-text text-sm focus:outline-none focus:border-iron-green ${props.className ?? ''}`}
    />
  );
}

function Btn({
  onClick, disabled, busy, children, variant = 'primary', className,
}: {
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  children: React.ReactNode;
  variant?: 'primary' | 'ghost' | 'danger';
  className?: string;
}) {
  const base = 'px-3 py-1.5 rounded text-sm font-medium transition-colors disabled:opacity-50';
  const cls =
    variant === 'primary' ? `${base} bg-iron-green hover:bg-iron-green-light text-white` :
    variant === 'danger'  ? `${base} bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-600/30` :
    `${base} border border-iron-border text-iron-muted hover:text-iron-text`;
  return (
    <button type="button" className={`${cls} ${className ?? ''}`} onClick={onClick} disabled={disabled || busy}>
      {busy ? 'Saving…' : children}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function GuestHubMenuPanel({ restaurantId }: { restaurantId: string }) {
  const [tree,      setTree]      = useState<MenuTree | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view,      setView]      = useState<PanelView>({ kind: 'empty' });
  const [busy,      setBusy]      = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [toast,     setToast]     = useState<string | null>(null);
  const [catForm,   setCatForm]   = useState<CatForm>(EMPTY_CAT);
  const [dishForm,  setDishForm]  = useState<DishForm>(EMPTY_DISH);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.admin.guestHub.menu.get(restaurantId);
      setTree(data as MenuTree);
    } catch {
      setLoadError('Failed to load menu. Try refreshing.');
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  // Silent tree refresh used inside save flows — never shows the spinner,
  // so the form and error state stay mounted during the background fetch.
  const refreshTree = useCallback(async () => {
    try {
      const data = await api.admin.guestHub.menu.get(restaurantId);
      setTree(data as MenuTree);
    } catch {
      // silent — tree stays stale; user can reload
    }
  }, [restaurantId]);

  useEffect(() => { void reload(); }, [reload]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  function clearForm() {
    setSaveError(null);
    setFieldErrs({});
  }

  // All categories flattened across menus
  const allCategories: CategoryDto[] = tree?.menus.flatMap(m => m.categories) ?? [];

  function findCategory(catId: string): CategoryDto | null {
    return allCategories.find(c => c.id === catId) ?? null;
  }

  // ── Navigation helpers ──────────────────────────────────────────────────────

  function openNewCat() {
    setCatForm(EMPTY_CAT);
    clearForm();
    setView({ kind: 'new-cat' });
  }

  function openEditCat(catId: string) {
    const cat = findCategory(catId);
    if (!cat) return;
    setCatForm({ name: cat.name, description: cat.description ?? '' });
    clearForm();
    setView({ kind: 'edit-cat', catId });
  }

  function openCatDishes(catId: string) {
    clearForm();
    setView({ kind: 'cat-dishes', catId });
  }

  function openNewDish(catId: string) {
    setDishForm(EMPTY_DISH);
    clearForm();
    setView({ kind: 'new-dish', catId });
  }

  function openEditDish(catId: string, dishId: string) {
    const cat  = findCategory(catId);
    const dish = cat?.dishes.find(d => d.id === dishId);
    if (!dish) return;
    setDishForm({
      name:        dish.name,
      subtitle:    dish.subtitle    ?? '',
      description: dish.description ?? '',
      price:       dish.price       ?? '',
      tag:         dish.tag         ?? '',
      dietaryTags: dish.dietaryTags.join(', '),
      availability: dish.availability,
      isFeatured:  dish.isFeatured,
      imageUrl:    dish.imageUrl    ?? '',
      isHidden:    dish.isHidden,
    });
    clearForm();
    setView({ kind: 'edit-dish', catId, dishId });
  }

  // ── Save: category ──────────────────────────────────────────────────────────

  async function saveCategory() {
    clearForm();
    if (!catForm.name.trim()) {
      setFieldErrs({ name: 'Category name is required' });
      return;
    }
    const isNew  = view.kind === 'new-cat';
    const editId = view.kind === 'edit-cat' ? view.catId : '';
    setBusy(true);
    try {
      if (isNew) {
        const nextSortOrder = allCategories.length === 0
          ? 0
          : Math.min(Math.max(...allCategories.map(c => c.sortOrder)) + 1, 9999);
        const created = await api.admin.guestHub.menu.createCategory(restaurantId, {
          name:        catForm.name.trim(),
          description: catForm.description.trim() || null,
          sortOrder:   nextSortOrder,
        });
        await refreshTree();
        showToast('Category created');
        setView({ kind: 'cat-dishes', catId: created.id });
      } else if (editId) {
        await api.admin.guestHub.menu.updateCategory(restaurantId, editId, {
          name:        catForm.name.trim(),
          description: catForm.description.trim() || null,
        });
        await refreshTree();
        showToast('Category updated');
        setView({ kind: 'cat-dishes', catId: editId });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const fe = err.fieldErrors as Record<string, string[]>;
        if (Object.keys(fe).length > 0) {
          setFieldErrs(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])));
        } else if (err.code === 'CONFLICT') {
          setFieldErrs({ name: err.message });
        } else {
          setSaveError(err.message);
        }
      } else {
        console.error('[saveCategory] unexpected error:', err);
        setSaveError('Failed to save category — please try again');
      }
    } finally { setBusy(false); }
  }

  // ── Save: dish ──────────────────────────────────────────────────────────────

  async function saveDish() {
    clearForm();
    if (!dishForm.name.trim()) {
      setFieldErrs({ name: 'Dish name is required' });
      return;
    }
    setBusy(true);
    const catId = view.kind === 'new-dish' || view.kind === 'edit-dish' ? view.catId : '';
    const cat   = findCategory(catId);
    const body: Record<string, unknown> = {
      name:         dishForm.name.trim(),
      subtitle:     dishForm.subtitle.trim()     || null,
      description:  dishForm.description.trim()  || null,
      price:        dishForm.price.trim()        || null,
      tag:          dishForm.tag.trim()          || null,
      imageUrl:     dishForm.imageUrl.trim()     || null,
      dietaryTags:  dishForm.dietaryTags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean),
      availability: dishForm.availability,
      isFeatured:   dishForm.isFeatured,
      isHidden:     dishForm.isHidden,
    };
    try {
      if (view.kind === 'new-dish') {
        const existingDishes = cat?.dishes ?? [];
        body.sortOrder = existingDishes.length === 0
          ? 0
          : Math.min(Math.max(...existingDishes.map(d => d.sortOrder)) + 1, 9999);
        await api.admin.guestHub.menu.createDish(restaurantId, catId, body);
        showToast('Dish added');
      } else if (view.kind === 'edit-dish') {
        await api.admin.guestHub.menu.updateDish(restaurantId, catId, view.dishId, body);
        showToast('Dish updated');
      }
      await refreshTree();
      setView({ kind: 'cat-dishes', catId });
    } catch (err) {
      if (err instanceof ApiError) {
        const fe = err.fieldErrors as Record<string, string[]>;
        if (Object.keys(fe).length > 0) {
          setFieldErrs(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v[0] ?? ''])));
        } else if (err.code === 'CONFLICT') {
          setFieldErrs({ name: err.message });
        } else {
          setSaveError(err.message);
        }
      } else {
        console.error('[saveDish] unexpected error:', err);
        setSaveError('Failed to save dish — please try again');
      }
    } finally { setBusy(false); }
  }

  // ── Quick toggles ───────────────────────────────────────────────────────────

  async function quickHideCat(catId: string, isHidden: boolean) {
    try {
      await api.admin.guestHub.menu.updateCategory(restaurantId, catId, { isHidden });
      await refreshTree();
    } catch { /* silent — UI stays consistent */ }
  }

  async function quickHideDish(catId: string, dishId: string, isHidden: boolean) {
    try {
      await api.admin.guestHub.menu.updateDish(restaurantId, catId, dishId, { isHidden });
      await refreshTree();
    } catch { /* silent */ }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="w-5 h-5 border-2 border-iron-green border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="bg-iron-card border border-red-900/30 rounded-xl p-5">
        <p className="text-red-400 text-sm">{loadError}</p>
      </div>
    );
  }

  const isEditingCatForm  = view.kind === 'new-cat'  || view.kind === 'edit-cat';
  const isEditingDishForm = view.kind === 'new-dish' || view.kind === 'edit-dish';
  const activeCatId = (view.kind === 'cat-dishes' || view.kind === 'edit-cat' || view.kind === 'new-dish' || view.kind === 'edit-dish')
    ? (view as { catId: string }).catId
    : null;

  return (
    <div className="space-y-4">

      {/* Info banner */}
      <div className="flex items-start gap-2.5 bg-iron-bg border border-iron-border rounded-lg px-4 py-3">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-iron-muted flex-shrink-0 mt-0.5" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <p className="text-xs text-iron-muted leading-relaxed">
          Menu changes take effect <span className="text-iron-text">immediately</span> on the live Guest Hub page. No publish step required.
        </p>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 bg-iron-card border border-iron-border rounded-lg text-sm text-iron-text shadow-xl pointer-events-none">
          {toast}
        </div>
      )}

      {/* 2-panel layout */}
      <div className="flex border border-iron-border rounded-xl overflow-hidden min-h-[400px]">

        {/* ── Left: category list ─────────────────────────────────────────── */}
        <div className="w-48 flex-shrink-0 border-r border-iron-border flex flex-col">
          <div className="px-3 py-2.5 border-b border-iron-border flex items-center justify-between">
            <span className="text-xs font-semibold text-iron-muted uppercase tracking-widest">Categories</span>
            <button
              type="button"
              onClick={openNewCat}
              className="text-iron-muted hover:text-iron-green transition-colors"
              title="Add category"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {allCategories.length === 0 ? (
              <p className="text-xs text-iron-muted p-3 leading-relaxed">No categories yet. Click + to add one.</p>
            ) : (
              allCategories.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => openCatDishes(cat.id)}
                  className={`w-full text-left px-3 py-2.5 border-b border-iron-border/60 transition-colors flex items-center gap-1.5 ${
                    activeCatId === cat.id
                      ? 'bg-iron-card text-iron-text'
                      : 'text-iron-muted hover:text-iron-text hover:bg-iron-card/50'
                  }`}
                >
                  {cat.isHidden && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 opacity-50" aria-hidden="true">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  )}
                  <span className="text-xs truncate flex-1">{cat.name}</span>
                  <span className="text-xs text-iron-muted/60 flex-shrink-0">{cat.dishes.length}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ── Right: detail / form ────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">

          {/* Empty state */}
          {view.kind === 'empty' && (
            <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center">
              <p className="text-iron-muted text-sm mb-1">Select a category to see its dishes</p>
              <p className="text-iron-muted/60 text-xs">or click + to create a new one</p>
            </div>
          )}

          {/* Category form */}
          {isEditingCatForm && (
            <div className="p-5 space-y-4">
              <h5 className="text-sm font-semibold text-iron-text">
                {view.kind === 'new-cat' ? 'New Category' : 'Edit Category'}
              </h5>
              <Field label="Name *" error={fieldErrs.name}>
                <Inp
                  value={catForm.name}
                  onChange={e => setCatForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Starters"
                  maxLength={80}
                  dir="auto"
                  className={fieldErrs.name ? 'border-red-500/60 focus:border-red-500/60' : ''}
                />
              </Field>
              <Field label="Description" error={fieldErrs.description}>
                <Inp
                  value={catForm.description}
                  onChange={e => setCatForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Optional short description"
                  maxLength={300}
                  dir="auto"
                  className={fieldErrs.description ? 'border-red-500/60 focus:border-red-500/60' : ''}
                />
              </Field>
              {saveError && <p className="text-sm text-red-400">{saveError}</p>}
              <div className="flex gap-2 pt-1">
                <Btn variant="primary" onClick={saveCategory} busy={busy}>Save</Btn>
                <Btn variant="ghost" onClick={() => setView(view.kind === 'edit-cat' ? { kind: 'cat-dishes', catId: view.catId } : { kind: 'empty' })} disabled={busy}>
                  Cancel
                </Btn>
              </div>
            </div>
          )}

          {/* Dish list (category selected) */}
          {view.kind === 'cat-dishes' && (() => {
            const cat = findCategory(view.catId);
            if (!cat) return <p className="p-5 text-iron-muted text-sm">Category not found.</p>;
            return (
              <div className="p-5">
                <div className="flex items-start justify-between mb-4 gap-3">
                  <div>
                    <h5 className="text-sm font-semibold text-iron-text flex items-center gap-2">
                      {cat.name}
                      {cat.isHidden && (
                        <span className="text-xs font-normal text-iron-muted bg-iron-bg border border-iron-border rounded px-1.5 py-0.5">Hidden</span>
                      )}
                    </h5>
                    {cat.description && <p className="text-xs text-iron-muted mt-0.5">{cat.description}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => quickHideCat(cat.id, !cat.isHidden)}
                      className="text-xs text-iron-muted hover:text-iron-text border border-iron-border rounded px-2 py-1 transition-colors"
                      title={cat.isHidden ? 'Make visible' : 'Hide category'}
                    >
                      {cat.isHidden ? 'Show' : 'Hide'}
                    </button>
                    <Btn variant="ghost" onClick={() => openEditCat(cat.id)}>Edit</Btn>
                  </div>
                </div>

                {cat.dishes.length === 0 ? (
                  <p className="text-iron-muted text-sm mb-4">No dishes yet.</p>
                ) : (
                  <div className="space-y-2 mb-4">
                    {cat.dishes.map(dish => (
                      <DishRow
                        key={dish.id}
                        dish={dish}
                        onEdit={() => openEditDish(cat.id, dish.id)}
                        onToggleHide={() => quickHideDish(cat.id, dish.id, !dish.isHidden)}
                      />
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => openNewDish(cat.id)}
                  className="text-xs text-iron-muted hover:text-iron-green transition-colors flex items-center gap-1"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Add dish
                </button>
              </div>
            );
          })()}

          {/* Dish form */}
          {isEditingDishForm && (
            <div className="p-5 space-y-3 overflow-y-auto">
              <h5 className="text-sm font-semibold text-iron-text">
                {view.kind === 'new-dish' ? 'New Dish' : 'Edit Dish'}
              </h5>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Name *" error={fieldErrs.name}>
                  <Inp
                    value={dishForm.name}
                    onChange={e => setDishForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Grilled Sea Bass"
                    maxLength={100}
                    dir="auto"
                    className={fieldErrs.name ? 'border-red-500/60 focus:border-red-500/60' : ''}
                  />
                </Field>
                <Field label="Price" error={fieldErrs.price}>
                  <Inp
                    value={dishForm.price}
                    onChange={e => setDishForm(f => ({ ...f, price: e.target.value }))}
                    placeholder="e.g. 89"
                    maxLength={50}
                  />
                </Field>
              </div>
              <Field label="Subtitle" error={fieldErrs.subtitle}>
                <Inp
                  value={dishForm.subtitle}
                  onChange={e => setDishForm(f => ({ ...f, subtitle: e.target.value }))}
                  placeholder="e.g. with lemon butter sauce"
                  maxLength={150}
                  dir="auto"
                  className={fieldErrs.subtitle ? 'border-red-500/60 focus:border-red-500/60' : ''}
                />
              </Field>
              <Field label="Description" error={fieldErrs.description}>
                <Textarea
                  value={dishForm.description}
                  onChange={e => setDishForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Short editorial description…"
                  maxLength={500}
                  rows={3}
                  dir="auto"
                  className={fieldErrs.description ? 'border-red-500/60 focus:border-red-500/60' : ''}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Tag" error={fieldErrs.tag}>
                  <Inp
                    value={dishForm.tag}
                    onChange={e => setDishForm(f => ({ ...f, tag: e.target.value }))}
                    placeholder="e.g. Chef's Selection"
                    maxLength={50}
                  />
                </Field>
                <Field label="Availability" error={fieldErrs.availability}>
                  <Select
                    value={dishForm.availability}
                    onChange={e => setDishForm(f => ({ ...f, availability: e.target.value }))}
                  >
                    {AVAILABILITY_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <Field label="Dietary tags" error={fieldErrs.dietaryTags} hint="Comma-separated, e.g. vegan, gluten-free">
                <Inp
                  value={dishForm.dietaryTags}
                  onChange={e => setDishForm(f => ({ ...f, dietaryTags: e.target.value }))}
                  placeholder="vegan, gluten-free"
                />
              </Field>
              <ImageUploadField
                label="Image"
                imageType="dish"
                value={dishForm.imageUrl}
                onChange={url => setDishForm(f => ({ ...f, imageUrl: url }))}
                error={fieldErrs.imageUrl}
              />
              <div className="flex items-center gap-6 pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-iron-muted hover:text-iron-text">
                  <input
                    type="checkbox"
                    checked={dishForm.isFeatured}
                    onChange={e => setDishForm(f => ({ ...f, isFeatured: e.target.checked }))}
                    className="rounded border-iron-border accent-iron-green"
                  />
                  Featured
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm text-iron-muted hover:text-iron-text">
                  <input
                    type="checkbox"
                    checked={dishForm.isHidden}
                    onChange={e => setDishForm(f => ({ ...f, isHidden: e.target.checked }))}
                    className="rounded border-iron-border accent-iron-green"
                  />
                  Hidden
                </label>
              </div>
              {saveError && <p className="text-sm text-red-400">{saveError}</p>}
              <div className="flex gap-2 pt-1">
                <Btn variant="primary" onClick={saveDish} busy={busy}>Save</Btn>
                <Btn
                  variant="ghost"
                  onClick={() => setView({ kind: 'cat-dishes', catId: (view as { catId: string }).catId })}
                  disabled={busy}
                >
                  Cancel
                </Btn>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ── Dish row ──────────────────────────────────────────────────────────────────

function DishRow({
  dish, onEdit, onToggleHide,
}: {
  dish: DishDto;
  onEdit: () => void;
  onToggleHide: () => void;
}) {
  return (
    <div className={`flex items-center gap-2 p-2.5 rounded-lg border transition-colors ${
      dish.isHidden ? 'border-iron-border/50 bg-iron-bg/50 opacity-60' : 'border-iron-border bg-iron-bg'
    }`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-iron-text truncate">{dish.name}</span>
          {dish.tag && (
            <span className="text-xs text-iron-muted/70 bg-iron-card border border-iron-border rounded px-1.5 py-0.5 flex-shrink-0">
              {dish.tag}
            </span>
          )}
          {dish.availability !== 'AVAILABLE' && (
            <span className={`text-xs flex-shrink-0 ${dish.availability === 'SOLD_OUT' ? 'text-iron-muted/60' : 'text-amber-400/80'}`}>
              {{ SOLD_OUT: 'Sold out', SEASONAL: 'Seasonal', BREAKFAST_ONLY: 'Breakfast only', DINNER_ONLY: 'Dinner only' }[dish.availability] ?? dish.availability}
            </span>
          )}
        </div>
        {dish.price && <p className="text-xs text-iron-muted mt-0.5">₪{dish.price}</p>}
      </div>
      <button
        type="button"
        onClick={onToggleHide}
        className="text-xs text-iron-muted hover:text-iron-text border border-iron-border rounded px-2 py-0.5 transition-colors flex-shrink-0"
        title={dish.isHidden ? 'Make visible' : 'Hide dish'}
      >
        {dish.isHidden ? 'Show' : 'Hide'}
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="text-xs text-iron-muted hover:text-iron-text border border-iron-border rounded px-2 py-0.5 transition-colors flex-shrink-0"
      >
        Edit
      </button>
    </div>
  );
}
