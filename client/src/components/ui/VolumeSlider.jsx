import React, { useRef, useCallback } from 'react';
import { IoMdVolumeHigh, IoMdVolumeLow, IoMdVolumeMute } from 'react-icons/io';

const VolumeSlider = ({ value = 1, disabled = false, onChange }) => {
    const trackRef = useRef(null);

    const calculateVolume = useCallback((clientX) => {
        if (!trackRef.current) return value;
        const rect = trackRef.current.getBoundingClientRect();
        const x = clientX - rect.left;
        const percentage = Math.max(0, Math.min(1, x / rect.width));
        return Math.round(percentage * 100) / 100;
    }, [value]);

    const handleMouseDown = useCallback((e) => {
        if (disabled) return;
        e.preventDefault();

        const newVolume = calculateVolume(e.clientX);
        onChange?.(newVolume);

        const handleMouseMove = (moveEvent) => {
            const vol = calculateVolume(moveEvent.clientX);
            onChange?.(vol);
        };

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }, [disabled, calculateVolume, onChange]);

    const handleTouchStart = useCallback((e) => {
        if (disabled) return;

        const touch = e.touches[0];
        const newVolume = calculateVolume(touch.clientX);
        onChange?.(newVolume);

        const handleTouchMove = (moveEvent) => {
            const t = moveEvent.touches[0];
            const vol = calculateVolume(t.clientX);
            onChange?.(vol);
        };

        const handleTouchEnd = () => {
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleTouchEnd);
        };

        document.addEventListener('touchmove', handleTouchMove);
        document.addEventListener('touchend', handleTouchEnd);
    }, [disabled, calculateVolume, onChange]);

    const VolumeIcon = value === 0 ? IoMdVolumeMute : value < 0.5 ? IoMdVolumeLow : IoMdVolumeHigh;
    const percentage = value * 100;

    return (
        <div className={`flex items-center gap-2 bg-zinc-900 border border-zinc-900 px-4 py-2 select-none ${disabled ? 'opacity-50' : ''}`}>
            <VolumeIcon className={`w-4 h-4 shrink-0 ${disabled ? 'text-zinc-600' : 'text-white'}`} />
            <div
                ref={trackRef}
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
                className={`relative w-32 h-4 bg-zinc-800 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
            >
                {/* Filled portion - white */}
                <div
                    className="absolute inset-y-0 left-0 bg-zinc-50 transition-[width] duration-75"
                    style={{ width: `${percentage}%` }}
                />
                {/* Thumb indicator */}
                <div
                    className={`absolute top-0 h-full w-1 -translate-x-1/2 transition-[left] duration-75 ${disabled ? 'bg-zinc-600' : 'bg-white'}`}
                    style={{ left: `${percentage}%` }}
                />
            </div>
            <span className={`text-xs w-8 text-right tabular-nums ${disabled ? 'text-zinc-600' : 'text-white'}`}>
                {Math.round(percentage)}%
            </span>
        </div>
    );
};

export default VolumeSlider;
