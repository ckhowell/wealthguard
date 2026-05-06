import React from 'react';

interface SkeletonProps {
  className?: string;
}

const Skeleton: React.FC<SkeletonProps> = ({ className = '' }) => (
  <div
    className={`animate-pulse bg-stone-200 dark:bg-stone-800 rounded ${className}`}
    aria-busy="true"
  />
);

export default Skeleton;
