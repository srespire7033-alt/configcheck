'use client';

import { useState, useEffect } from 'react';
import { getCategoryLabel, getShortCategoryLabel } from '@/lib/utils';
import { DollarSign, Percent, Package, GitBranch, Settings, FileText, Handshake, Variable, ShieldCheck, Code, SlidersHorizontal, Compass, Layers, Gauge, Network, ChevronRight, GripVertical, Receipt, BookOpen, Landmark, Building2, CircleDollarSign, Scale, BadgeDollarSign, FileCheck, Boxes, Search, Repeat, ListChecks, FileType, Tag, Zap, ArrowDownToLine, Sparkles, Table2, Workflow, Globe, Gauge as GaugeIcon, Hash, Boxes as BoxesIcon, Activity, FileSignature, Clock, Wallet } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CategoryScores } from '@/types';

const STORAGE_KEY = 'configcheck-category-order';

const BILLING_CATEGORIES = new Set([
  'billing_rules', 'rev_rec_rules', 'tax_rules', 'finance_books',
  'gl_rules', 'legal_entity', 'product_billing_config', 'invoicing',
]);

// Icon audit (#18): every category gets a distinct, semantically meaningful
// icon. Previously: 16 ARM categories all fell through to the FileText
// fallback (indistinguishable in the grid). Also fixed: `subscriptions`
// was using RefreshCw which collides with the re-scan button; now uses Repeat.
// `quote_lines` was using FileText (the fallback); now ListChecks.
const categoryIcons: Record<string, React.ElementType> = {
  // CPQ
  price_rules: DollarSign,
  discount_schedules: Percent,
  products: Package,
  product_rules: GitBranch,
  cpq_settings: Settings,
  subscriptions: Repeat,
  quote_lines: ListChecks,
  contracted_prices: Handshake,
  summary_variables: Variable,
  approval_rules: ShieldCheck,
  quote_calculator_plugin: Code,
  quote_templates: FileType,
  configuration_attributes: SlidersHorizontal,
  guided_selling: Compass,
  advanced_pricing: Layers,
  performance: Gauge,
  impact_analysis: Network,
  bundles: Boxes,
  lookup_queries: Search,
  // Billing
  billing_rules: Receipt,
  rev_rec_rules: BookOpen,
  tax_rules: Landmark,
  finance_books: CircleDollarSign,
  gl_rules: Scale,
  legal_entity: Building2,
  product_billing_config: BadgeDollarSign,
  invoicing: FileCheck,
  // ARM / Revenue Cloud — each gets a distinct icon (previously all FileText)
  arm_product_catalog: Package,
  arm_selling_models: Tag,
  arm_price_adjustments: ArrowDownToLine,
  arm_attribute_pricing: Sparkles,
  arm_bundles: BoxesIcon,
  arm_pricing_procedures: Workflow,
  arm_price_books: BookOpen,
  arm_decision_tables: Table2,
  arm_context_service: Globe,
  arm_rate_cards: GaugeIcon,
  arm_attributes: Hash,
  arm_assets: Activity,
  arm_contracts: FileSignature,
  arm_usage_management: Clock,
  arm_orchestration: Zap,
  arm_cost_books: Wallet,
  // v5 — Tax / Billing / GL / Clauses / Qualification / Ramp
  arm_tax: Receipt,
  arm_billing_policies: BookOpen,
  arm_general_ledger: Scale,
  arm_clauses: FileSignature,
  arm_product_qualification: ShieldCheck,
  arm_ramp_deals: Zap,
};

interface CategoryBreakdownProps {
  scores: CategoryScores;
  issues?: { category: string; severity: string }[];
  layout?: 'vertical' | 'horizontal';
  selectedCategory?: string | null;
  onCategoryClick?: (category: string) => void;
}

// Sortable card wrapper
function SortableCategoryCard({
  id,
  category,
  score,
  critical,
  warning,
  total,
  isSelected,
  onCategoryClick,
}: {
  id: string;
  category: string;
  score: number;
  critical: number;
  warning: number;
  total: number;
  isSelected: boolean;
  onCategoryClick?: (category: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  };

  const Icon = categoryIcons[category] || FileText;

  function getBarColor(s: number): string {
    if (s >= 80) return 'bg-green-500';
    if (s >= 60) return 'bg-amber-500';
    return 'bg-red-500';
  }

  function getScoreTextColor(s: number): string {
    if (s >= 80) return 'text-green-600';
    if (s >= 60) return 'text-amber-600';
    return 'text-red-600';
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`text-left bg-white dark:bg-[#111827] rounded-xl border shadow-sm transition-all duration-200 ${
        isDragging
          ? 'shadow-xl scale-105 border-blue-400 dark:border-blue-500 opacity-90'
          : isSelected
          ? 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-500/20 dark:ring-blue-400/20'
          : 'border-gray-100 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600'
      }`}
    >
      {/* Drag handle + clickable area */}
      <div className="flex">
        {/* Drag handle — hidden on mobile */}
        <div
          {...attributes}
          {...listeners}
          className="hidden sm:flex items-center justify-center w-8 flex-shrink-0 cursor-grab active:cursor-grabbing text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 transition rounded-l-xl hover:bg-gray-50 dark:hover:bg-gray-800/50"
          title="Drag to reorder"
        >
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Card content — clickable */}
        <button
          onClick={() => onCategoryClick?.(category)}
          className="flex-1 text-left p-3 sm:p-4 min-w-0"
        >
          <div className="flex items-start justify-between mb-3 gap-2">
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isSelected ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'}`} />
              {/*
                Short label so the most common categories no longer truncate
                in the 5-up grid. Full label is exposed via title for
                hover/screen-reader and stays in modals/reports.
              */}
              <span
                className={`text-sm font-medium leading-tight ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'}`}
                title={getCategoryLabel(category)}
                style={{
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {getShortCategoryLabel(category)}
              </span>
            </div>
            <span className={`text-lg font-bold flex-shrink-0 ${getScoreTextColor(score)}`}>
              {score}%
            </span>
          </div>
          <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${getBarColor(score)} transition-all duration-700`}
              style={{ width: `${score}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {total === 0
                ? 'No issues'
                : critical > 0
                ? `${critical} critical, ${warning} warning${warning !== 1 ? 's' : ''}`
                : `${warning} warning${warning !== 1 ? 's' : ''}`}
            </p>
            <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${
              isSelected ? 'text-blue-500 rotate-90' : 'text-gray-300 dark:text-gray-600'
            }`} />
          </div>
        </button>
      </div>
    </div>
  );
}

export function CategoryBreakdown({ scores, issues = [], layout = 'vertical', selectedCategory, onCategoryClick }: CategoryBreakdownProps) {
  const allEntries = Object.entries(scores as unknown as Record<string, number>);

  // Load saved order from localStorage
  const [orderedCategories, setOrderedCategories] = useState<string[]>([]);

  // Re-derive order whenever the set of categories in scores changes
  const scoreKeys = allEntries.map(([cat]) => cat).sort().join(',');

  useEffect(() => {
    if (!scoreKeys) return; // No scores yet
    const allCats = scoreKeys.split(',');
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const savedOrder: string[] = JSON.parse(saved);
        // Merge: use saved order, append any new categories at the end
        const merged = [
          ...savedOrder.filter((cat) => allCats.includes(cat)),
          ...allCats.filter((cat) => !savedOrder.includes(cat)),
        ];
        setOrderedCategories(merged);
      } catch {
        setOrderedCategories([...allEntries].sort(([, a], [, b]) => a - b).map(([cat]) => cat));
      }
    } else {
      // Default: sort by score ascending (worst first)
      setOrderedCategories([...allEntries].sort(([, a], [, b]) => a - b).map(([cat]) => cat));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoreKeys]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 }, // 8px drag threshold to distinguish from clicks
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setOrderedCategories((prev) => {
        const oldIndex = prev.indexOf(active.id as string);
        const newIndex = prev.indexOf(over.id as string);
        const newOrder = arrayMove(prev, oldIndex, newIndex);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newOrder));
        return newOrder;
      });
    }
  }

  function resetOrder() {
    const defaultOrder = allEntries.sort(([, a], [, b]) => a - b).map(([cat]) => cat);
    setOrderedCategories(defaultOrder);
    localStorage.removeItem(STORAGE_KEY);
  }

  const scoresMap = Object.fromEntries(allEntries) as Record<string, number>;

  function getCategoryCounts(category: string) {
    const catIssues = issues.filter((i) => i.category === category);
    const critical = catIssues.filter((i) => i.severity === 'critical').length;
    const warning = catIssues.filter((i) => i.severity === 'warning').length;
    const info = catIssues.filter((i) => i.severity === 'info').length;
    return { critical, warning, info, total: critical + warning + info };
  }

  function getBarColor(score: number): string {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-amber-500';
    return 'bg-red-500';
  }

  function getScoreTextColor(score: number): string {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-amber-600';
    return 'text-red-600';
  }

  if (layout === 'horizontal') {
    // Wait for client-side hydration
    if (orderedCategories.length === 0) {
      return <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 animate-pulse">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-28 bg-gray-100 dark:bg-gray-800 rounded-xl" />
        ))}
      </div>;
    }

    // Split into CPQ and Billing groups
    const cpqCategories = orderedCategories.filter((c) => !BILLING_CATEGORIES.has(c) && scoresMap[c] !== undefined);
    const billingCategories = orderedCategories.filter((c) => BILLING_CATEGORIES.has(c) && scoresMap[c] !== undefined);

    const hasBilling = billingCategories.length > 0;

    return (
      <div>
        <div className="hidden sm:flex items-center justify-between mb-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
            <GripVertical className="w-3 h-3" />
            Drag cards to reorder
          </p>
          <button
            onClick={resetOrder}
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400 transition"
          >
            Reset order
          </button>
        </div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={orderedCategories} strategy={rectSortingStrategy}>
            {/* CPQ Categories */}
            {hasBilling && (
              <div className="flex items-center gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">CPQ</span>
                </div>
                <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
              </div>
            )}
            <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {cpqCategories.map((category) => {
                const score = scoresMap[category];
                if (score === undefined) return null;
                const { critical, warning, total } = getCategoryCounts(category);
                return (
                  <SortableCategoryCard
                    key={category}
                    id={category}
                    category={category}
                    score={score}
                    critical={critical}
                    warning={warning}
                    total={total}
                    isSelected={selectedCategory === category}
                    onCategoryClick={onCategoryClick}
                  />
                );
              })}
            </div>

            {/* Billing Categories */}
            {hasBilling && (
              <>
                <div className="flex items-center gap-3 mt-6 mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Billing</span>
                  </div>
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                </div>
                <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                  {billingCategories.map((category) => {
                    const score = scoresMap[category];
                    if (score === undefined) return null;
                    const { critical, warning, total } = getCategoryCounts(category);
                    return (
                      <SortableCategoryCard
                        key={category}
                        id={category}
                        category={category}
                        score={score}
                        critical={critical}
                        warning={warning}
                        total={total}
                        isSelected={selectedCategory === category}
                        onCategoryClick={onCategoryClick}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </SortableContext>
        </DndContext>
      </div>
    );
  }

  // Vertical layout (non-draggable — used in other places)
  const verticalEntries = allEntries.sort(([, a], [, b]) => a - b);

  return (
    <div className="space-y-4">
      {verticalEntries.map(([category, score]) => {
        const Icon = categoryIcons[category] || FileText;
        return (
          <div key={category}>
            <div className="flex justify-between items-center mb-1.5">
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-gray-400 dark:text-gray-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {getCategoryLabel(category)}
                </span>
              </div>
              <span className={`text-sm font-bold ${getScoreTextColor(score)}`}>
                {score}/100
              </span>
            </div>
            <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full ${getBarColor(score)} transition-all duration-1000 ease-out`}
                style={{ width: `${score}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
