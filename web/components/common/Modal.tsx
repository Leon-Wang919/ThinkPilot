"use client";

import React from "react";
import Modal from "@/components/ui/Modal";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  titleIcon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: "sm" | "md" | "lg" | "xl";
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
}

export default function CommonModal({
  isOpen,
  onClose,
  title,
  titleIcon,
  children,
  footer,
  width = "md",
  closeOnBackdrop = true,
}: ModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        title || titleIcon ? (
          <span className="inline-flex items-center gap-2">
            {titleIcon}
            {title}
          </span>
        ) : undefined
      }
      size={width}
      footer={footer}
      closeOnBackdrop={closeOnBackdrop}
    >
      {children}
    </Modal>
  );
}
