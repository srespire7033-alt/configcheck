'use client';

import { useState, useEffect } from 'react';
import { getCategoryLabel } from '@/lib/utils';
import { DollarSign, Percent, Package, GitBranch, Settings, RefreshCw, FileText, Handshake, Variable, ShieldCheck, Code, FileSpreadsheet, SlidersHorizontal, Compass, Layers, Gauge, Network, ChevronRight, GripVertical, Receipt, BookOpen, Landmark, Building2, CircleDollarSign, Scale, BadgeDollarSign, FileCheck } from 'lucide-react';
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

const categoryIcons: Record<string, React.ElementType> = {
  price_rules: DollarSign,
  discount_schedules: Percent,
  products: Package,
  product_rules: GitBranch,
  cpq_settings: Settings,
  subscriptions: RefreshCw,
  quote_lines: FileText,
  contracted_prices: Handshake,
  summary_variables: Variable,
  approval_rules: ShieldCheck,
  quote_calculator_plugin: Code,
  quote_templates: FileSpreadsheet,
  configuration_attributes: SlidersHorizontal,
  guided_selling: Compass,
  advanced_pricing: Layers,
  performance: Gauge,
  impact_analysis: Network,
  // Billing categories
  billing_rules: Receipt,
  rev_rec_rules: BookOpen,
  tax_rules: Landmark,
  finance_books: CircleDollarSign,
  gl_rules: Scale,
  legal_entity: Building2,
  product_billing_config: BadgeDollarSign,
  invoicing: FileCheck,
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
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <Icon className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'}`} />
              <span className={`text-sm font-medium truncate ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-600 dark:text-gray-300'}`}>
                {getCategoryLabel(category)}
              </span>
            </div>
            <span className={`text-lg font-bold flex-shrink-0 ml-2 ${getScoreTextColor(score)}`}>
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

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const savedOrder: string[] = JSON.parse(saved);
        // Merge: use saved order, append any new categories at the end
        const allCats = allEntries.map(([cat]) => cat);
        const merged = [
          ...savedOrder.filter((cat) => allCats.includes(cat)),
          ...allCats.filter((cat) => !savedOrder.includes(cat)),
        ];
        setOrderedCategories(merged);
      } catch {
        setOrderedCategories(allEntries.sort(([, a], [, b]) => a - b).map(([cat]) => cat));
      }
    } else {
      // Default: sort by score ascending (worst first)
      setOrderedCategories(allEntries.sort(([, a], [, b]) => a - b).map(([cat]) => cat));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
              {orderedCategories.map((category) => {
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
