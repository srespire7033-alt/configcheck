'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react';

interface TourStep {
  target: string;
  title: string;
  description: string;
  position: 'top' | 'bottom' | 'left' | 'right';
}

interface ProductTourProps {
  tourId: string;
  steps: TourStep[];
  onComplete?: () => void;
}

export function ProductTour({ tourId, steps, onComplete }: ProductTourProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [visible, setVisible] = useState(false);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const [arrowStyle, setArrowStyle] = useState<React.CSSProperties>({});
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [arrowDirection, setArrowDirection] = useState<'top' | 'bottom' | 'left' | 'right'>('top');
  const tooltipRef = useRef<HTMLDivElement>(null);
  const prevElementRef = useRef<Element | null>(null);

  const storageKey = `configcheck_tour_${tourId}`;

  useEffect(() => {
    const completed = localStorage.getItem(storageKey);
    if (completed) return;

    const timer = setTimeout(() => setVisible(true), 1000);
    return () => clearTimeout(timer);
  }, [storageKey]);

  const positionTooltip = useCallback(() => {
    if (!visible || !steps[currentStep]) return;

    const step = steps[currentStep];
    const el = document.querySelector(step.target);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const tooltipWidth = 320;
    const tooltipHeight = tooltipRef.current?.offsetHeight || 200;
    const gap = 16;
    const arrowSize = 8;

    let top = 0;
    let left = 0;
    let aTop = 0;
    let aLeft = 0;
    let aDir: 'top' | 'bottom' | 'left' | 'right' = 'top';

    switch (step.position) {
      case 'bottom':
        top = rect.bottom + gap + window.scrollY;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        aTop = -arrowSize * 2;
        aLeft = tooltipWidth / 2 - arrowSize;
        aDir = 'top';
        break;
      case 'top':
        top = rect.top - tooltipHeight - gap + window.scrollY;
        left = rect.left + rect.width / 2 - tooltipWidth / 2;
        aTop = tooltipHeight;
        aLeft = tooltipWidth / 2 - arrowSize;
        aDir = 'bottom';
        break;
      case 'right':
        top = rect.top + rect.height / 2 - tooltipHeight / 2 + window.scrollY;
        left = rect.right + gap;
        aTop = tooltipHeight / 2 - arrowSize;
        aLeft = -arrowSize * 2;
        aDir = 'left';
        break;
      case 'left':
        top = rect.top + rect.height / 2 - tooltipHeight / 2 + window.scrollY;
        left = rect.left - tooltipWidth - gap;
        aTop = tooltipHeight / 2 - arrowSize;
        aLeft = tooltipWidth;
        aDir = 'right';
        break;
    }

    // Clamp to viewport
    left = Math.max(12, Math.min(left, window.innerWidth - tooltipWidth - 12));

    setTooltipStyle({
      position: 'absolute',
      top: `${top}px`,
      left: `${left}px`,
      width: `${tooltipWidth}px`,
      zIndex: 10002,
    });

    const arrowBorders: Record<string, string> = {
      top: `transparent transparent white transparent`,
      bottom: `white transparent transparent transparent`,
      left: `transparent white transparent transparent`,
      right: `transparent transparent transparent white`,
    };

    setArrowStyle({
      position: 'absolute',
      top: `${aTop}px`,
      left: `${aLeft}px`,
      width: 0,
      height: 0,
      borderStyle: 'solid',
      borderWidth: `${arrowSize}px`,
      borderColor: arrowBorders[aDir],
    });

    setArrowDirection(aDir);
  }, [currentStep, visible, steps]);

  useEffect(() => {
    if (!visible) return;

    const step = steps[currentStep];
    const el = document.querySelector(step.target);

    // Remove highlight from previous element
    if (prevElementRef.current && prevElementRef.current !== el) {
      prevElementRef.current.classList.remove('tour-highlight');
    }

    if (!el) return;

    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('tour-highlight');
    prevElementRef.current = el;

    // Position after a short delay to let scroll finish
    const timer = setTimeout(positionTooltip, 300);

    const handleResize = () => positionTooltip();
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
    };
  }, [currentStep, visible, steps, positionTooltip]);

  // Re-position when the tooltip renders (so we have the correct height)
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(positionTooltip);
    }
  }, [visible, currentStep, positionTooltip]);

  const handleComplete = useCallback(() => {
    localStorage.setItem(storageKey, 'true');
    // Clean up highlight
    if (prevElementRef.current) {
      prevElementRef.current.classList.remove('tour-highlight');
      prevElementRef.current = null;
    }
    setVisible(false);
    onComplete?.();
  }, [storageKey, onComplete]);

  const handleNext = useCallback(() => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleComplete();
    }
  }, [currentStep, steps.length, handleComplete]);

  const handlePrev = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  }, [currentStep]);

  const handleOverlayClick = useCallback(() => {
    handleComplete();
  }, [handleComplete]);

  if (!visible || steps.length === 0) return null;

  const step = steps[currentStep];
  const isFirst = currentStep === 0;
  const isLast = currentStep === steps.length - 1;

  return (
    <>
      {/* Spotlight CSS */}
      <style>{`
        .tour-highlight {
          position: relative !important;
          z-index: 10001 !important;
          box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.4), 0 0 20px rgba(37, 99, 235, 0.2) !important;
          border-radius: 8px !important;
          animation: tour-pulse 2s ease-in-out infinite !important;
        }
        @keyframes tour-pulse {
          0%, 100% {
            box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.4), 0 0 20px rgba(37, 99, 235, 0.2);
          }
          50% {
            box-shadow: 0 0 0 6px rgba(37, 99, 235, 0.3), 0 0 30px rgba(37, 99, 235, 0.15);
          }
        }
        .tour-tooltip-enter {
          animation: tour-fade-in 0.2s ease-out forwards;
        }
        @keyframes tour-fade-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* Overlay */}
      <div
        onClick={handleOverlayClick}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 10000,
          cursor: 'pointer',
        }}
      />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="tour-tooltip-enter"
        style={tooltipStyle}
      >
        {/* Arrow */}
        <div style={arrowStyle} />

        {/* Card */}
        <div
          style={{
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15), 0 4px 16px rgba(0, 0, 0, 0.1)',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 16px 0',
            }}
          >
            <span
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: '#2563eb',
                background: '#eff6ff',
                padding: '2px 10px',
                borderRadius: '100px',
              }}
            >
              {currentStep + 1} of {steps.length}
            </span>
            <button
              onClick={handleComplete}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px',
                color: '#9ca3af',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '6px',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#6b7280')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#9ca3af')}
              aria-label="Close tour"
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div style={{ padding: '12px 16px 16px' }}>
            <h3
              style={{
                margin: '0 0 6px',
                fontSize: '15px',
                fontWeight: 700,
                color: '#1f2937',
              }}
            >
              {step.title}
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: '13px',
                lineHeight: 1.5,
                color: '#6b7280',
              }}
            >
              {step.description}
            </p>
          </div>

          {/* Footer */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0 16px 14px',
              gap: '8px',
            }}
          >
            <button
              onClick={handlePrev}
              disabled={isFirst}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '7px 14px',
                fontSize: '13px',
                fontWeight: 500,
                color: isFirst ? '#d1d5db' : '#374151',
                background: 'none',
                border: '1px solid',
                borderColor: isFirst ? '#e5e7eb' : '#d1d5db',
                borderRadius: '8px',
                cursor: isFirst ? 'default' : 'pointer',
              }}
            >
              <ChevronLeft size={14} />
              Previous
            </button>

            <button
              onClick={handleNext}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '7px 14px',
                fontSize: '13px',
                fontWeight: 600,
                color: 'white',
                background: '#2563eb',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#1d4ed8')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#2563eb')}
            >
              {isLast ? (
                <>
                  Done
                  <Check size={14} />
                </>
              ) : (
                <>
                  Next
                  <ChevronRight size={14} />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
