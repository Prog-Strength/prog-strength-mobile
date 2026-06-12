// Pantry view inside the Nutrition tab. Hosts a nested Items / Recipes
// segmented control because both lists are managed against the same
// pantry-item catalog — recipes are built FROM items, so keeping them
// in sibling tabs would make the user bounce between tabs to add a
// missing component. See initial-mobile-app-implementation SOW for the
// nesting rationale (5-tab bar cap).
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { clearToken, getToken } from "@/lib/auth";
import {
  createPantryItem,
  createRecipe,
  deletePantryItem,
  deleteRecipe,
  listPantryItems,
  listRecipes,
  updatePantryItem,
  updateRecipe,
  type PantryItem,
  type PantryItemPayload,
  type Recipe,
  type RecipePayload,
} from "@/lib/api";
import { SegmentedControl, type Segment } from "@/components/segmented-control";
import { PantryItemForm } from "@/components/nutrition/pantry-item-form";
import { RecipeForm } from "@/components/nutrition/recipe-form";

type PantrySegment = "items" | "recipes";

const SEGMENTS: readonly Segment<PantrySegment>[] = [
  { value: "items", label: "Items" },
  { value: "recipes", label: "Recipes" },
];

export function PantryView() {
  const router = useRouter();
  const [segment, setSegment] = useState<PantrySegment>("items");
  const [items, setItems] = useState<PantryItem[] | null>(null);
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    setError(null);
    Promise.resolve(getToken())
      .then(async (t) => {
        if (!t) {
          router.replace("/login");
          return;
        }
        const [i, r] = await Promise.all([listPantryItems(t), listRecipes(t)]);
        setItems(i);
        setRecipes(r);
      })
      .catch((err: Error) => {
        if (err.message.toLowerCase().includes("401")) {
          clearToken();
          router.replace("/login");
          return;
        }
        setError(err.message);
      });
  }, [router]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return (
    <View className="flex-1">
      <View className="px-4 pb-2">
        <SegmentedControl
          value={segment}
          onChange={setSegment}
          segments={SEGMENTS}
          ariaLabel="Pantry sections"
        />
      </View>
      {error && (
        <View className="mx-4 mb-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2">
          <Text className="text-xs text-danger">{error}</Text>
        </View>
      )}
      {segment === "items" ? (
        <ItemsSection items={items} onChanged={refetch} />
      ) : (
        <RecipesSection recipes={recipes} items={items ?? []} onChanged={refetch} />
      )}
    </View>
  );
}

// --- Items --------------------------------------------------------

function ItemsSection({ items, onChanged }: { items: PantryItem[] | null; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function withToken<T>(fn: (t: string) => Promise<T>): Promise<T> {
    const t = await getToken();
    if (!t) throw new Error("not signed in");
    return fn(t);
  }

  async function handleCreate(payload: PantryItemPayload) {
    setBusy(true);
    setFormError(null);
    try {
      await withToken((t) => createPantryItem(t, payload));
      setAdding(false);
      onChanged();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(id: string, payload: PantryItemPayload) {
    setBusy(true);
    setFormError(null);
    try {
      await withToken((t) => updatePantryItem(t, id, payload));
      setEditingId(null);
      onChanged();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    try {
      await withToken((t) => deletePantryItem(t, id));
      onChanged();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (items === null) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(p) => p.id}
      contentContainerClassName="gap-2 px-4 pb-8"
      ListHeaderComponent={
        <View className="gap-2 pt-1">
          <View className="flex-row items-center justify-between">
            <Text className="text-lg font-semibold text-foreground">Items ({items.length})</Text>
            {!adding && (
              <Pressable
                onPress={() => {
                  setAdding(true);
                  setFormError(null);
                }}
                accessibilityRole="button"
                className="rounded-md bg-accent px-3 py-1.5 active:opacity-80"
              >
                <Text className="text-xs font-medium text-accent-fg">+ New</Text>
              </Pressable>
            )}
          </View>
          {adding && (
            <PantryItemForm
              submitLabel="Save"
              busy={busy}
              error={formError}
              onSubmit={handleCreate}
              onCancel={() => {
                setAdding(false);
                setFormError(null);
              }}
            />
          )}
        </View>
      }
      ListEmptyComponent={
        !adding ? (
          <View className="rounded-lg border border-border bg-surface px-4 py-8">
            <Text className="text-center text-sm text-muted">
              No pantry items yet. Tap “New” to add one.
            </Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => {
        const editing = editingId === item.id;
        if (editing) {
          return (
            <PantryItemForm
              initial={item}
              submitLabel="Save"
              busy={busy}
              error={formError}
              onSubmit={(payload) => handleUpdate(item.id, payload)}
              onCancel={() => {
                setEditingId(null);
                setFormError(null);
              }}
            />
          );
        }
        return (
          <Pressable
            onPress={() => {
              setEditingId(item.id);
              setFormError(null);
            }}
            accessibilityRole="button"
            className="rounded-lg border border-border bg-surface p-3 active:opacity-80"
          >
            <View className="flex-row items-center justify-between gap-2">
              <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={1}>
                {item.name}
              </Text>
              <Pressable
                onPress={() => handleDelete(item.id)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Delete pantry item"
                hitSlop={8}
                className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 active:opacity-80 disabled:opacity-50"
              >
                <Text className="text-xs text-danger">Delete</Text>
              </Pressable>
            </View>
            <Text className="mt-1 text-xs text-muted">
              {formatNumber(item.calories)} cal · {formatNumber(item.protein_g)}P /{" "}
              {formatNumber(item.fat_g)}F / {formatNumber(item.carbs_g)}C · per{" "}
              {formatNumber(item.serving_size)} {item.serving_unit}
            </Text>
          </Pressable>
        );
      }}
    />
  );
}

// --- Recipes ------------------------------------------------------

function RecipesSection({
  recipes,
  items,
  onChanged,
}: {
  recipes: Recipe[] | null;
  items: PantryItem[];
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function withToken<T>(fn: (t: string) => Promise<T>): Promise<T> {
    const t = await getToken();
    if (!t) throw new Error("not signed in");
    return fn(t);
  }

  async function handleCreate(payload: RecipePayload) {
    setBusy(true);
    setFormError(null);
    try {
      await withToken((t) => createRecipe(t, payload));
      setAdding(false);
      onChanged();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdate(id: string, payload: RecipePayload) {
    setBusy(true);
    setFormError(null);
    try {
      await withToken((t) => updateRecipe(t, id, payload));
      setEditingId(null);
      onChanged();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    setBusy(true);
    try {
      await withToken((t) => deleteRecipe(t, id));
      onChanged();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (recipes === null) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      data={recipes}
      keyExtractor={(r) => r.id}
      contentContainerClassName="gap-2 px-4 pb-8"
      ListHeaderComponent={
        <View className="gap-2 pt-1">
          <View className="flex-row items-center justify-between">
            <Text className="text-lg font-semibold text-foreground">
              Recipes ({recipes.length})
            </Text>
            {!adding && (
              <Pressable
                onPress={() => {
                  setAdding(true);
                  setFormError(null);
                }}
                accessibilityRole="button"
                className="rounded-md bg-accent px-3 py-1.5 active:opacity-80"
              >
                <Text className="text-xs font-medium text-accent-fg">+ New</Text>
              </Pressable>
            )}
          </View>
          {adding && (
            <RecipeForm
              pantry={items}
              submitLabel="Save"
              busy={busy}
              error={formError}
              onSubmit={handleCreate}
              onCancel={() => {
                setAdding(false);
                setFormError(null);
              }}
            />
          )}
        </View>
      }
      ListEmptyComponent={
        !adding ? (
          <View className="rounded-lg border border-border bg-surface px-4 py-8">
            <Text className="text-center text-sm text-muted">
              No recipes yet. Combine pantry items into a saved meal.
            </Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => {
        const editing = editingId === item.id;
        if (editing) {
          return (
            <RecipeForm
              initial={item}
              pantry={items}
              submitLabel="Save"
              busy={busy}
              error={formError}
              onSubmit={(payload) => handleUpdate(item.id, payload)}
              onCancel={() => {
                setEditingId(null);
                setFormError(null);
              }}
            />
          );
        }
        return (
          <Pressable
            onPress={() => {
              setEditingId(item.id);
              setFormError(null);
            }}
            accessibilityRole="button"
            className="rounded-lg border border-border bg-surface p-3 active:opacity-80"
          >
            <View className="flex-row items-center justify-between gap-2">
              <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={1}>
                {item.name}
              </Text>
              <Pressable
                onPress={() => handleDelete(item.id)}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Delete recipe"
                hitSlop={8}
                className="rounded-md border border-danger/40 bg-danger/10 px-2 py-1 active:opacity-80 disabled:opacity-50"
              >
                <Text className="text-xs text-danger">Delete</Text>
              </Pressable>
            </View>
            <Text className="mt-1 text-xs text-muted">
              {item.components.length} component
              {item.components.length === 1 ? "" : "s"} · {formatNumber(item.macros.calories)} cal ·{" "}
              {formatNumber(item.macros.protein_g)}P / {formatNumber(item.macros.fat_g)}F /{" "}
              {formatNumber(item.macros.carbs_g)}C
            </Text>
          </Pressable>
        );
      }}
    />
  );
}

function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return "—";
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
