import React, { useMemo } from 'react';
import VirtualMessageList from '@/components/VirtualMessageList';

export interface VirtualFeedListProps<T extends { id: string; createdAt: number }> {
  items: readonly T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  loading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  height?: number | string;
  className?: string;
}

export function VirtualFeedList<T extends { id: string; createdAt: number }>({
  items,
  renderItem,
  loading = false,
  hasMore = false,
  onLoadMore,
  height = 'min(68dvh, 760px)',
  className = '',
}: VirtualFeedListProps<T>) {
  const virtualItems = useMemo(() => items.map((item) => ({
    id: `feed-${item.id}`,
    senderId: item.id,
    content: '',
    timestamp: item.createdAt,
  })), [items]);

  return (
    <VirtualMessageList
      messages={virtualItems}
      currentUserId="__feed__"
      loading={loading}
      hasMore={hasMore}
      onLoadMore={onLoadMore}
      loadMoreAt="bottom"
      height={height}
      className={className}
      estimatedRowHeight={280}
      renderMessage={(_, __, index) => renderItem(items[index], index)}
    />
  );
}

export default VirtualFeedList;
