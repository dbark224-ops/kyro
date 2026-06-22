import { useQuery } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system/legacy";
import { useRouter } from "expo-router";
import {
  CheckCircle2,
  ChevronRight,
  Eraser,
  ExternalLink,
  Image as ImageIcon,
  PenLine,
  Send,
  X
} from "lucide-react-native";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  KeyboardAvoidingView,
  Image,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  TextInput,
  View
} from "react-native";
import Svg, { Path } from "react-native-svg";

import { useAuthSession } from "@/features/auth/auth-context";
import { mobileFilePreviewQueryOptions } from "@/lib/mobile-query";
import type {
  AssistantLink,
  AssistantThreadMessage,
  AssistantUiBlock,
  AssistantUiTone
} from "@/lib/mobile-api-types";
import { colors, radii, typography } from "@/theme";

export type MobileGeneratedImage = Extract<
  AssistantUiBlock,
  { type: "generated_image" }
>["images"][number];

export type GeneratedImageEditAttachment = {
  id: string;
  mimeType: string;
  name: string;
  size: number | null;
  uri: string;
};

export type GeneratedImageEditSubmission = {
  hasMarkup: boolean;
  image: MobileGeneratedImage;
  markupAttachment: GeneratedImageEditAttachment | null;
  request: string;
};

type AnnotationPoint = {
  x: number;
  y: number;
};

type AnnotationStroke = AnnotationPoint[];

type ImageFrame = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export const AssistantMessageBlocks = memo(function AssistantMessageBlocks({
  isSending = false,
  message,
  onSubmitGeneratedImageEdit,
  showDeveloperMetadata = false
}: {
  isSending?: boolean;
  message: AssistantThreadMessage;
  onSubmitGeneratedImageEdit?: (submission: GeneratedImageEditSubmission) => void;
  showDeveloperMetadata?: boolean;
}) {
  const router = useRouter();
  const blocks = message.uiBlocks ?? [];

  if (!blocks.length) {
    return <AssistantMessageLinks links={message.links ?? []} />;
  }

  return (
    <View style={styles.stack}>
      {blocks.map((block, index) => (
        <AssistantBlock
          block={block}
          key={`${message.id}-${block.type}-${index}`}
          isSending={isSending}
          showDeveloperMetadata={showDeveloperMetadata}
          onOpenHref={(href) => openAssistantHref(href, router)}
          onSubmitGeneratedImageEdit={onSubmitGeneratedImageEdit}
        />
      ))}
    </View>
  );
});

function AssistantMessageLinks({ links }: { links: AssistantLink[] }) {
  const visibleLinks = links.filter((link) => link.href && link.label);

  if (!visibleLinks.length) {
    return null;
  }

  return <AssistantLinkRail links={visibleLinks} />;
}

function AssistantLinkRail({ links }: { links: AssistantLink[] }) {
  const router = useRouter();
  const imageLinks = dedupeFileLinks(links);
  const imageFileIds = new Set(imageLinks.map((item) => item.fileId));
  const regularLinks = links.filter((link) => {
    const fileId = fileIdFromAssistantHref(link.href);

    return !fileId || !imageFileIds.has(fileId);
  });

  return (
    <View style={styles.stack}>
      {imageLinks.length ? (
        <ScrollView
          contentContainerStyle={styles.generatedList}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.generatedScroller}
        >
          {imageLinks.map(({ fileId, link }) => (
            <FilePreviewCard
              fileId={fileId}
              key={`${fileId}-${link.href}`}
              label={link.label}
              meta={link.meta ?? undefined}
            />
          ))}
        </ScrollView>
      ) : null}
      {regularLinks.length ? (
        <ScrollView
          contentContainerStyle={styles.linkRail}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.linkScroller}
        >
          {regularLinks.map((link) => (
            <LinkCard
              href={link.href}
              key={link.href}
              label={link.label}
              meta={link.meta ?? undefined}
              onOpenHref={(href) => openAssistantHref(href, router)}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function AssistantBlock({
  block,
  isSending,
  showDeveloperMetadata,
  onOpenHref,
  onSubmitGeneratedImageEdit
}: {
  block: AssistantUiBlock;
  isSending: boolean;
  showDeveloperMetadata: boolean;
  onOpenHref: (href: string) => void;
  onSubmitGeneratedImageEdit?: (submission: GeneratedImageEditSubmission) => void;
}) {
  if (block.type === "summary_cards") {
    return (
      <View style={styles.block}>
        <Text style={styles.blockTitle}>{block.title}</Text>
        <View style={styles.summaryGrid}>
          {block.cards.map((card) => (
            <SummaryCard
              detail={card.detail}
              href={card.href}
              key={`${card.label}-${card.value}`}
              label={card.label}
              onOpenHref={onOpenHref}
              tone={card.tone}
              value={card.value}
            />
          ))}
        </View>
      </View>
    );
  }

  if (block.type === "link_cards") {
    return <AssistantLinkRail links={block.links} />;
  }

  if (block.type === "timeline") {
    return (
      <View style={styles.block}>
        <Text style={styles.blockTitle}>{block.title}</Text>
        <View style={styles.timeline}>
          {block.items.map((item) => (
            <TimelineItem
              detail={item.detail}
              href={item.href}
              key={`${item.label}-${item.at ?? ""}`}
              label={item.label}
              onOpenHref={onOpenHref}
              time={item.at}
              tone={item.tone}
            />
          ))}
        </View>
      </View>
    );
  }

  if (block.type === "approval_queue") {
    return (
      <View style={styles.block}>
        <Text style={styles.blockTitle}>{block.title}</Text>
        <View style={styles.approvalList}>
          {block.items.map((item) => (
            <ApprovalItem
              detail={item.detail}
              href={item.href}
              key={item.id}
              label={item.label}
              onOpenHref={onOpenHref}
              status={item.status}
            />
          ))}
        </View>
      </View>
    );
  }

  if (block.type === "generated_image") {
    return (
      <View style={styles.block}>
        <Text style={styles.blockTitle}>{block.title}</Text>
        <ScrollView
          contentContainerStyle={styles.generatedList}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.generatedScroller}
        >
          {block.images.map((image) => (
            <GeneratedImageCard
              disabled={isSending}
              image={image}
              key={image.fileId}
              onSubmitEdit={onSubmitGeneratedImageEdit}
              showDeveloperMetadata={showDeveloperMetadata}
            />
          ))}
        </ScrollView>
      </View>
    );
  }

  if (block.type === "memory_notice" || block.type === "memory_suggestion") {
    return (
      <View style={styles.notice}>
        <Text style={styles.noticeTitle}>{block.title}</Text>
        <Text style={styles.noticeText}>{block.content}</Text>
      </View>
    );
  }

  return null;
}

function GeneratedImageCard({
  disabled,
  image,
  onSubmitEdit,
  showDeveloperMetadata
}: {
  disabled: boolean;
  image: MobileGeneratedImage;
  onSubmitEdit?: (submission: GeneratedImageEditSubmission) => void;
  showDeveloperMetadata: boolean;
}) {
  const [hasImageError, setHasImageError] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [startPreviewInEditMode, setStartPreviewInEditMode] = useState(false);
  const { session } = useAuthSession();
  const preview = useQuery({
    ...mobileFilePreviewQueryOptions(session, image.fileId),
    enabled: Boolean(session?.access_token && image.fileId)
  });
  const imageUri = preview.data?.dataUri ?? null;
  const showFallback = hasImageError || Boolean(preview.error);
  const canPreview = Boolean(imageUri && !showFallback);
  const openPreview = (startEditing: boolean) => {
    setStartPreviewInEditMode(startEditing);
    setIsPreviewOpen(true);
  };

  return (
    <>
      <View style={styles.generatedImageCard}>
        <Pressable
          accessibilityRole="imagebutton"
          disabled={!canPreview}
          onPress={() => openPreview(false)}
          style={({ pressed }) => [
            styles.generatedImageButton,
            { aspectRatio: imageAspectRatio(image.size) },
            pressed ? styles.pressed : null
          ]}
        >
          {showFallback ? (
            <View style={styles.generatedImageFallback}>
              <ImageIcon color={colors.cyan} size={24} strokeWidth={2.3} />
              <Text numberOfLines={2} style={styles.generatedImageFallbackText}>
                Image saved to Kyro files
              </Text>
            </View>
          ) : !imageUri ? (
            <View style={styles.generatedImageFallback}>
              <ImageIcon color={colors.cyan} size={24} strokeWidth={2.3} />
              <Text numberOfLines={2} style={styles.generatedImageFallbackText}>
                Loading image...
              </Text>
            </View>
          ) : (
            <Image
              onError={() => setHasImageError(true)}
              resizeMode="cover"
              source={{ uri: imageUri }}
              style={styles.generatedImage}
            />
          )}
        </Pressable>
        {canPreview && onSubmitEdit ? (
          <Pressable
            accessibilityLabel="Edit generated image"
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => openPreview(true)}
            style={({ pressed }) => [
              styles.generatedImageEditButton,
              pressed ? styles.pressed : null,
              disabled ? styles.disabled : null
            ]}
          >
            <PenLine color={colors.text} size={14} strokeWidth={2.5} />
            <Text style={styles.generatedImageEditText}>Edit</Text>
          </Pressable>
        ) : null}
        <View style={styles.generatedImageMeta}>
          <View style={styles.linkCopy}>
            <Text numberOfLines={1} style={styles.linkLabel}>
              {image.filename}
            </Text>
            <Text numberOfLines={1} style={styles.linkMeta}>
              {showDeveloperMetadata ? image.meta ?? image.size : image.size}
            </Text>
          </View>
          <View style={styles.generatedImageAction}>
            <ImageIcon color={colors.cyan} size={15} strokeWidth={2.4} />
          </View>
        </View>
      </View>
      <FullscreenImagePreview
        aspectRatio={imageAspectRatio(image.size)}
        editableImage={image}
        isSubmitting={disabled}
        onClose={() => setIsPreviewOpen(false)}
        onSubmitGeneratedImageEdit={onSubmitEdit}
        startInEditMode={startPreviewInEditMode}
        uri={imageUri}
        visible={isPreviewOpen}
      />
    </>
  );
}

function FilePreviewCard({
  fileId,
  label,
  meta
}: {
  fileId: string;
  label: string;
  meta?: string;
}) {
  const [hasImageError, setHasImageError] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const { session } = useAuthSession();
  const preview = useQuery({
    ...mobileFilePreviewQueryOptions(session, fileId),
    enabled: Boolean(session?.access_token && fileId)
  });
  const imageUri = preview.data?.dataUri ?? null;
  const showFallback = hasImageError || Boolean(preview.error);
  const canPreview = Boolean(imageUri && !showFallback);

  return (
    <>
      <View style={styles.generatedImageCard}>
        <Pressable
          accessibilityRole="imagebutton"
          disabled={!canPreview}
          onPress={() => setIsPreviewOpen(true)}
          style={({ pressed }) => [
            styles.generatedImageButton,
            { aspectRatio: 16 / 9 },
            pressed ? styles.pressed : null
          ]}
        >
          {showFallback ? (
            <View style={styles.generatedImageFallback}>
              <ImageIcon color={colors.cyan} size={24} strokeWidth={2.3} />
              <Text numberOfLines={2} style={styles.generatedImageFallbackText}>
                Image saved to Kyro files
              </Text>
            </View>
          ) : !imageUri ? (
            <View style={styles.generatedImageFallback}>
              <ImageIcon color={colors.cyan} size={24} strokeWidth={2.3} />
              <Text numberOfLines={2} style={styles.generatedImageFallbackText}>
                Loading image...
              </Text>
            </View>
          ) : (
            <Image
              onError={() => setHasImageError(true)}
              resizeMode="cover"
              source={{ uri: imageUri }}
              style={styles.generatedImage}
            />
          )}
        </Pressable>
        <View style={styles.generatedImageMeta}>
          <View style={styles.linkCopy}>
            <Text numberOfLines={1} style={styles.linkLabel}>
              {label}
            </Text>
            {meta ? (
              <Text numberOfLines={1} style={styles.linkMeta}>
                {meta}
              </Text>
            ) : null}
          </View>
          <View style={styles.generatedImageAction}>
            <ImageIcon color={colors.cyan} size={15} strokeWidth={2.4} />
          </View>
        </View>
      </View>
      <FullscreenImagePreview
        aspectRatio={16 / 9}
        onClose={() => setIsPreviewOpen(false)}
        uri={imageUri}
        visible={isPreviewOpen}
      />
    </>
  );
}

function FullscreenImagePreview({
  aspectRatio = 16 / 9,
  editableImage,
  isSubmitting = false,
  onClose,
  onSubmitGeneratedImageEdit,
  startInEditMode = false,
  uri,
  visible
}: {
  aspectRatio?: number;
  editableImage?: MobileGeneratedImage;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmitGeneratedImageEdit?: (submission: GeneratedImageEditSubmission) => void;
  startInEditMode?: boolean;
  uri: string | null;
  visible: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const activeStrokeRef = useRef<AnnotationStroke | null>(null);
  const currentScale = useRef(1);
  const dragOffset = useRef({ x: 0, y: 0 });
  const pinchStartDistance = useRef(0);
  const pinchStartScale = useRef(1);
  const touchStart = useRef({ at: 0, hadMultiTouch: false });
  const [draftStroke, setDraftStroke] = useState<AnnotationStroke | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [isPreparingEdit, setIsPreparingEdit] = useState(false);
  const [previewSize, setPreviewSize] = useState({ height: 0, width: 0 });
  const [strokes, setStrokes] = useState<AnnotationStroke[]>([]);
  const canEdit = Boolean(editableImage && onSubmitGeneratedImageEdit);
  const renderedStrokes = useMemo(
    () => (draftStroke ? [...strokes, draftStroke] : strokes),
    [draftStroke, strokes]
  );
  const imageFrame = useMemo(
    () => frameForContainedImage(previewSize, aspectRatio),
    [aspectRatio, previewSize]
  );
  const hasMarkup = renderedStrokes.some((stroke) => stroke.length > 0);

  const reset = useMemo(
    () => () => {
      currentScale.current = 1;
      dragOffset.current = { x: 0, y: 0 };
      scale.setValue(1);
      translateX.setValue(0);
      translateY.setValue(0);
    },
    [scale, translateX, translateY]
  );

  useEffect(() => {
    if (visible) {
      reset();
      setIsEditing(canEdit && startInEditMode);
      return;
    }

    activeStrokeRef.current = null;
    setDraftStroke(null);
    setEditError(null);
    setEditPrompt("");
    setIsEditing(false);
    setIsPreparingEdit(false);
    setStrokes([]);
  }, [canEdit, reset, startInEditMode, visible]);

  useEffect(() => {
    if (isEditing) {
      reset();
    }
  }, [isEditing, reset]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          visible &&
          !isEditing &&
          (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
        onStartShouldSetPanResponder: () => visible && !isEditing && !canEdit,
        onPanResponderGrant: (event) => {
          const touches = event.nativeEvent.touches;
          touchStart.current = {
            at: Date.now(),
            hadMultiTouch: touches.length > 1
          };

          if (touches.length > 1) {
            pinchStartDistance.current = touchDistance(touches);
            pinchStartScale.current = currentScale.current;
          }
        },
        onPanResponderMove: (event, gesture) => {
          const touches = event.nativeEvent.touches;

          if (touches.length > 1) {
            touchStart.current.hadMultiTouch = true;
            const startDistance = pinchStartDistance.current || touchDistance(touches);
            const nextScale = clamp(
              pinchStartScale.current * (touchDistance(touches) / startDistance),
              1,
              5
            );

            currentScale.current = nextScale;
            scale.setValue(nextScale);
            return;
          }

          if (currentScale.current <= 1) {
            return;
          }

          translateX.setValue(dragOffset.current.x + gesture.dx);
          translateY.setValue(dragOffset.current.y + gesture.dy);
        },
        onPanResponderRelease: (_event, gesture) => {
          const wasTap =
            !touchStart.current.hadMultiTouch &&
            Date.now() - touchStart.current.at < 220 &&
            Math.abs(gesture.dx) < 8 &&
            Math.abs(gesture.dy) < 8;

          if (wasTap) {
            onClose();
            return;
          }

          if (currentScale.current <= 1.02) {
            reset();
            return;
          }

          dragOffset.current = {
            x: dragOffset.current.x + gesture.dx,
            y: dragOffset.current.y + gesture.dy
          };
        },
        onPanResponderTerminate: () => {
          if (currentScale.current <= 1.02) {
            reset();
          }
        }
      }),
    [canEdit, isEditing, onClose, reset, scale, translateX, translateY, visible]
  );

  const drawResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: () => isEditing,
        onStartShouldSetPanResponder: () => isEditing,
        onPanResponderGrant: (event) => {
          const point = annotationPointFromEvent(event, imageFrame);
          const nextStroke = [point];

          activeStrokeRef.current = nextStroke;
          setDraftStroke(nextStroke);
          setEditError(null);
        },
        onPanResponderMove: (event) => {
          const currentStroke = activeStrokeRef.current;

          if (!currentStroke) {
            return;
          }

          const point = annotationPointFromEvent(event, imageFrame);
          const lastPoint = currentStroke[currentStroke.length - 1];

          if (
            lastPoint &&
            Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) < 0.0035
          ) {
            return;
          }

          const nextStroke = [...currentStroke, point];

          activeStrokeRef.current = nextStroke;
          setDraftStroke(nextStroke);
        },
        onPanResponderRelease: () => {
          const currentStroke = activeStrokeRef.current;

          if (currentStroke?.length) {
            setStrokes((current) => [...current, currentStroke]);
          }

          activeStrokeRef.current = null;
          setDraftStroke(null);
        },
        onPanResponderTerminate: () => {
          activeStrokeRef.current = null;
          setDraftStroke(null);
        }
      }),
    [imageFrame, isEditing]
  );

  const clearMarkup = () => {
    activeStrokeRef.current = null;
    setDraftStroke(null);
    setStrokes([]);
    setEditError(null);
  };

  const submitImageEdit = async () => {
    const request = editPrompt.trim();

    if (
      !editableImage ||
      !onSubmitGeneratedImageEdit ||
      isPreparingEdit ||
      isSubmitting
    ) {
      return;
    }

    if (!request && !hasMarkup) {
      setEditError("Add an edit note or draw red markup before sending.");
      return;
    }

    setEditError(null);
    setIsPreparingEdit(true);

    try {
      const markupAttachment = hasMarkup
        ? await createAnnotationAttachment({
            aspectRatio,
            image: editableImage,
            strokes: renderedStrokes
          })
        : null;

      onSubmitGeneratedImageEdit({
        hasMarkup,
        image: editableImage,
        markupAttachment,
        request
      });
      onClose();
    } catch (error) {
      setEditError(
        error instanceof Error
          ? error.message
          : "Unable to prepare the image markup."
      );
    } finally {
      setIsPreparingEdit(false);
    }
  };

  return (
    <Modal
      animationType="fade"
      hardwareAccelerated
      navigationBarTranslucent
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent
      visible={visible && Boolean(uri)}
    >
      <StatusBar hidden />
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: "padding", default: undefined })}
        style={styles.previewKeyboard}
      >
        <View
          onLayout={(event) => {
            const { height, width } = event.nativeEvent.layout;

            setPreviewSize({ height, width });
          }}
          style={styles.previewBackdrop}
          {...panResponder.panHandlers}
        >
          {uri && imageFrame.width > 0 && imageFrame.height > 0 ? (
            <Animated.View
              style={[
                styles.previewImageFrame,
                imageFrame,
                {
                  transform: [{ translateX }, { translateY }, { scale }]
                }
              ]}
            >
              <Image resizeMode="contain" source={{ uri }} style={styles.previewImage} />
              {canEdit ? (
                <View
                  pointerEvents={isEditing ? "auto" : "none"}
                  style={styles.previewAnnotationLayer}
                  {...(isEditing ? drawResponder.panHandlers : {})}
                >
                  <Svg
                    height="100%"
                    style={styles.previewAnnotationSvg}
                    viewBox={`0 0 ${imageFrame.width} ${imageFrame.height}`}
                    width="100%"
                  >
                    {renderedStrokes.map((stroke, index) => (
                      <Path
                        d={pathFromStroke(stroke, imageFrame)}
                        fill="none"
                        key={index}
                        stroke="#ff2b57"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={5}
                      />
                    ))}
                  </Svg>
                </View>
              ) : null}
            </Animated.View>
          ) : null}

          {canEdit && !isEditing ? (
            <View style={styles.previewToolbar}>
              <View style={styles.previewToolbarRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={onClose}
                  style={({ pressed }) => [
                    styles.previewToolbarIconButton,
                    pressed ? styles.pressed : null
                  ]}
                >
                  <X color={colors.text} size={18} strokeWidth={2.6} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSubmitting}
                  onPress={() => {
                    setEditError(null);
                    setIsEditing(true);
                  }}
                  style={({ pressed }) => [
                    styles.previewToolbarButton,
                    pressed ? styles.pressed : null,
                    isSubmitting ? styles.disabled : null
                  ]}
                >
                  <PenLine color={colors.text} size={17} strokeWidth={2.5} />
                  <Text style={styles.previewToolbarText}>Edit image</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {canEdit && isEditing ? (
            <View style={styles.previewEditPanel}>
              <View style={styles.previewEditHeader}>
                <View>
                  <Text style={styles.previewEditTitle}>Edit image</Text>
                  <Text style={styles.previewEditHint}>
                    Draw in red or type a direct change.
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={isPreparingEdit}
                  onPress={() => setIsEditing(false)}
                  style={styles.previewIconButton}
                >
                  <X color={colors.text} size={18} strokeWidth={2.6} />
                </Pressable>
              </View>
              <TextInput
                editable={!isSubmitting && !isPreparingEdit}
                multiline
                onChangeText={setEditPrompt}
                placeholder="e.g. make the sky night time and warm the house lights"
                placeholderTextColor={colors.muted}
                style={styles.previewEditInput}
                value={editPrompt}
              />
              {editError ? (
                <Text style={styles.previewEditError}>{editError}</Text>
              ) : null}
              <View style={styles.previewEditActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={!hasMarkup || isPreparingEdit}
                  onPress={clearMarkup}
                  style={({ pressed }) => [
                    styles.previewSecondaryAction,
                    pressed ? styles.pressed : null,
                    !hasMarkup || isPreparingEdit ? styles.disabled : null
                  ]}
                >
                  <Eraser color={colors.text} size={16} strokeWidth={2.4} />
                  <Text style={styles.previewSecondaryActionText}>Clear</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={isSubmitting || isPreparingEdit}
                  onPress={submitImageEdit}
                  style={({ pressed }) => [
                    styles.previewPrimaryAction,
                    pressed ? styles.pressed : null,
                    isSubmitting || isPreparingEdit ? styles.disabled : null
                  ]}
                >
                  <Send color={colors.background} size={16} strokeWidth={2.6} />
                  <Text style={styles.previewPrimaryActionText}>
                    {isPreparingEdit ? "Preparing" : "Send edit"}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SummaryCard({
  detail,
  href,
  label,
  onOpenHref,
  tone = "neutral",
  value
}: {
  detail?: string;
  href?: string;
  label: string;
  onOpenHref: (href: string) => void;
  tone?: AssistantUiTone;
  value: string;
}) {
  return (
    <Pressable
      accessibilityRole={href ? "button" : undefined}
      disabled={!href}
      onPress={href ? () => onOpenHref(href) : undefined}
      style={({ pressed }) => [
        styles.summaryCard,
        styles[`tone_${normalTone(tone)}`],
        pressed && href ? styles.pressed : null
      ]}
    >
      <Text numberOfLines={1} style={styles.cardLabel}>
        {label}
      </Text>
      <Text numberOfLines={1} style={styles.cardValue}>
        {value}
      </Text>
      {detail ? (
        <Text numberOfLines={2} style={styles.cardDetail}>
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

function LinkCard({
  href,
  icon,
  label,
  meta,
  onOpenHref
}: {
  href: string;
  icon?: "image";
  label: string;
  meta?: string;
  onOpenHref: (href: string) => void;
}) {
  const Icon = icon === "image" ? ImageIcon : isExternalHref(href) ? ExternalLink : ChevronRight;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onOpenHref(href)}
      style={({ pressed }) => [styles.linkCard, pressed ? styles.pressed : null]}
    >
      <View style={styles.linkCopy}>
        <Text numberOfLines={1} style={styles.linkLabel}>
          {label}
        </Text>
        {meta ? (
          <Text numberOfLines={2} style={styles.linkMeta}>
            {meta}
          </Text>
        ) : null}
      </View>
      <Icon color={colors.cyan} size={16} strokeWidth={2.5} />
    </Pressable>
  );
}

function TimelineItem({
  detail,
  href,
  label,
  onOpenHref,
  time,
  tone = "neutral"
}: {
  detail?: string;
  href?: string;
  label: string;
  onOpenHref: (href: string) => void;
  time?: string | null;
  tone?: AssistantUiTone;
}) {
  return (
    <Pressable
      accessibilityRole={href ? "button" : undefined}
      disabled={!href}
      onPress={href ? () => onOpenHref(href) : undefined}
      style={({ pressed }) => [styles.timelineItem, pressed && href ? styles.pressed : null]}
    >
      <View style={[styles.timelineDot, styles[`dot_${normalTone(tone)}`]]} />
      <View style={styles.timelineCopy}>
        <Text numberOfLines={1} style={styles.timelineLabel}>
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={2} style={styles.timelineDetail}>
            {detail}
          </Text>
        ) : null}
      </View>
      {time ? (
        <Text style={styles.timelineTime}>{formatBlockDate(time)}</Text>
      ) : null}
    </Pressable>
  );
}

function ApprovalItem({
  detail,
  href,
  label,
  onOpenHref,
  status
}: {
  detail?: string;
  href?: string;
  label: string;
  onOpenHref: (href: string) => void;
  status: string;
}) {
  return (
    <Pressable
      accessibilityRole={href ? "button" : undefined}
      disabled={!href}
      onPress={href ? () => onOpenHref(href) : undefined}
      style={({ pressed }) => [styles.approvalItem, pressed && href ? styles.pressed : null]}
    >
      <CheckCircle2 color={colors.warning} size={18} strokeWidth={2.4} />
      <View style={styles.approvalCopy}>
        <Text numberOfLines={1} style={styles.approvalLabel}>
          {label}
        </Text>
        {detail ? (
          <Text numberOfLines={2} style={styles.approvalDetail}>
            {detail}
          </Text>
        ) : null}
      </View>
      <Text numberOfLines={1} style={styles.statusText}>
        {formatLabel(status)}
      </Text>
    </Pressable>
  );
}

function dedupeFileLinks(links: AssistantLink[]) {
  const seen = new Set<string>();
  const fileLinks: Array<{ fileId: string; link: AssistantLink }> = [];

  for (const link of links) {
    const fileId = fileIdFromAssistantHref(link.href);

    if (!fileId || seen.has(fileId)) {
      continue;
    }

    seen.add(fileId);
    fileLinks.push({ fileId, link });
  }

  return fileLinks;
}

function openAssistantHref(href: string, router: ReturnType<typeof useRouter>) {
  if (isExternalHref(href)) {
    void Linking.openURL(href);
    return;
  }

  const [pathname, queryString = ""] = href.split("?");
  const params = Object.fromEntries(new URLSearchParams(queryString));
  const contactMatch = pathname.match(/^\/contacts\/([^/]+)$/);
  const inboxMatch = pathname.match(/^\/inbox\/([^/]+)$/);
  const documentMatch = pathname.match(/^\/documents\/([^/]+)$/);

  if (contactMatch?.[1]) {
    router.push({ pathname: "/crm", params: { contactId: contactMatch[1] } });
    return;
  }

  if (inboxMatch?.[1]) {
    router.push({
      pathname: "/inbox",
      params: { conversationId: inboxMatch[1] }
    });
    return;
  }

  if (documentMatch?.[1]) {
    router.push({ pathname: "/inbox", params: { quoteDraftId: documentMatch[1] } });
    return;
  }

  if (pathname === "/contacts") {
    router.push("/crm");
    return;
  }

  if (pathname === "/inbox") {
    router.push({ pathname: "/inbox", params });
    return;
  }

  if (pathname === "/settings") {
    router.push("/settings");
    return;
  }

  if (pathname === "/documents") {
    router.push({ pathname: "/inbox", params: { filter: "documents" } });
  }
}

function fileIdFromAssistantHref(href: string) {
  const pathname = pathnameFromHref(href);
  const match = pathname.match(/^\/api\/(?:mobile\/)?files\/([^/?#]+)$/);

  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function pathnameFromHref(href: string) {
  if (isExternalHref(href)) {
    try {
      return new URL(href).pathname;
    } catch {
      return "";
    }
  }

  return href.split("?")[0] ?? "";
}

function imageAspectRatio(size: string) {
  const match = size.match(/(\d+)\s*x\s*(\d+)/i);

  if (!match?.[1] || !match[2]) {
    return 16 / 9;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);

  if (!width || !height) {
    return 1;
  }

  return width / height;
}

function touchDistance(touches: ArrayLike<{ pageX: number; pageY: number }>) {
  const first = touches[0];
  const second = touches[1];

  if (!first || !second) {
    return 1;
  }

  return Math.hypot(first.pageX - second.pageX, first.pageY - second.pageY);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isExternalHref(href: string) {
  return /^https?:\/\//.test(href);
}

function normalTone(tone?: AssistantUiTone) {
  return tone === "success" ? "green" : tone === "warning" ? "warning" : (tone ?? "neutral");
}

function formatBlockDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short"
  }).format(date);
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function frameForContainedImage(
  container: { height: number; width: number },
  aspectRatio: number
): ImageFrame {
  if (!container.width || !container.height || !aspectRatio) {
    return { height: 0, left: 0, top: 0, width: 0 };
  }

  const containerAspect = container.width / container.height;
  const width =
    containerAspect > aspectRatio
      ? container.height * aspectRatio
      : container.width;
  const height =
    containerAspect > aspectRatio
      ? container.height
      : container.width / aspectRatio;

  return {
    height,
    left: (container.width - width) / 2,
    top: (container.height - height) / 2,
    width
  };
}

function annotationPointFromEvent(
  event: { nativeEvent: { locationX: number; locationY: number } },
  frame: ImageFrame
): AnnotationPoint {
  return {
    x: clamp(event.nativeEvent.locationX / Math.max(1, frame.width), 0, 1),
    y: clamp(event.nativeEvent.locationY / Math.max(1, frame.height), 0, 1)
  };
}

function pathFromStroke(stroke: AnnotationStroke, frame: ImageFrame) {
  return stroke
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";

      return `${command} ${point.x * frame.width} ${point.y * frame.height}`;
    })
    .join(" ");
}

async function createAnnotationAttachment({
  aspectRatio,
  image,
  strokes
}: {
  aspectRatio: number;
  image: MobileGeneratedImage;
  strokes: AnnotationStroke[];
}): Promise<GeneratedImageEditAttachment> {
  const cacheDirectory = FileSystem.cacheDirectory;

  if (!cacheDirectory) {
    throw new Error("Kyro cannot access the device cache for image markup.");
  }

  const { height, width } = annotationExportSize(aspectRatio);
  const bytes = renderAnnotationPng({ height, strokes, width });
  const base64 = base64FromBytes(bytes);
  const name = `markup-${safeFileSegment(image.fileId)}.png`;
  const uri = `${cacheDirectory}${Date.now()}-${name}`;

  await FileSystem.writeAsStringAsync(uri, base64, {
    encoding: FileSystem.EncodingType.Base64
  });

  return {
    id: `${image.fileId}-markup-${Date.now()}`,
    mimeType: "image/png",
    name,
    size: bytes.byteLength,
    uri
  };
}

function annotationExportSize(aspectRatio: number) {
  const longEdge = 768;

  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return { height: longEdge, width: longEdge };
  }

  if (aspectRatio >= 1) {
    return {
      height: Math.max(1, Math.round(longEdge / aspectRatio)),
      width: longEdge
    };
  }

  return {
    height: longEdge,
    width: Math.max(1, Math.round(longEdge * aspectRatio))
  };
}

function renderAnnotationPng({
  height,
  strokes,
  width
}: {
  height: number;
  strokes: AnnotationStroke[];
  width: number;
}) {
  const rowLength = width * 4 + 1;
  const raw = new Uint8Array(rowLength * height);
  const radius = Math.max(4, Math.round(Math.max(width, height) * 0.006));

  for (let y = 0; y < height; y += 1) {
    raw[y * rowLength] = 0;
  }

  for (const stroke of strokes) {
    drawAnnotationStroke({ height, radius, raw, rowLength, stroke, width });
  }

  return encodePng({ height, raw, width });
}

function drawAnnotationStroke({
  height,
  radius,
  raw,
  rowLength,
  stroke,
  width
}: {
  height: number;
  radius: number;
  raw: Uint8Array;
  rowLength: number;
  stroke: AnnotationStroke;
  width: number;
}) {
  if (stroke.length === 0) {
    return;
  }

  if (stroke.length === 1) {
    drawAnnotationBrush({
      height,
      radius,
      raw,
      rowLength,
      width,
      x: stroke[0].x * (width - 1),
      y: stroke[0].y * (height - 1)
    });
    return;
  }

  for (let index = 1; index < stroke.length; index += 1) {
    const previous = stroke[index - 1];
    const point = stroke[index];
    const startX = previous.x * (width - 1);
    const startY = previous.y * (height - 1);
    const endX = point.x * (width - 1);
    const endY = point.y * (height - 1);
    const distance = Math.hypot(endX - startX, endY - startY);
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius * 0.45)));

    for (let step = 0; step <= steps; step += 1) {
      const progress = step / steps;

      drawAnnotationBrush({
        height,
        radius,
        raw,
        rowLength,
        width,
        x: startX + (endX - startX) * progress,
        y: startY + (endY - startY) * progress
      });
    }
  }
}

function drawAnnotationBrush({
  height,
  radius,
  raw,
  rowLength,
  width,
  x,
  y
}: {
  height: number;
  radius: number;
  raw: Uint8Array;
  rowLength: number;
  width: number;
  x: number;
  y: number;
}) {
  const minX = Math.max(0, Math.floor(x - radius));
  const maxX = Math.min(width - 1, Math.ceil(x + radius));
  const minY = Math.max(0, Math.floor(y - radius));
  const maxY = Math.min(height - 1, Math.ceil(y + radius));
  const radiusSquared = radius * radius;

  for (let pixelY = minY; pixelY <= maxY; pixelY += 1) {
    for (let pixelX = minX; pixelX <= maxX; pixelX += 1) {
      const dx = pixelX - x;
      const dy = pixelY - y;

      if (dx * dx + dy * dy > radiusSquared) {
        continue;
      }

      const offset = pixelY * rowLength + 1 + pixelX * 4;

      raw[offset] = 255;
      raw[offset + 1] = 43;
      raw[offset + 2] = 87;
      raw[offset + 3] = 235;
    }
  }
}

function encodePng({
  height,
  raw,
  width
}: {
  height: number;
  raw: Uint8Array;
  width: number;
}) {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);

  writeUint32(ihdr, 0, width);
  writeUint32(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return concatBytes([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlibStore(raw)),
    pngChunk("IEND", new Uint8Array(0))
  ]);
}

function zlibStore(raw: Uint8Array) {
  const blocks: Uint8Array[] = [];
  let offset = 0;

  while (offset < raw.length) {
    const length = Math.min(65535, raw.length - offset);
    const block = new Uint8Array(5 + length);
    const isFinal = offset + length >= raw.length;

    block[0] = isFinal ? 1 : 0;
    block[1] = length & 0xff;
    block[2] = (length >> 8) & 0xff;
    block[3] = (~length) & 0xff;
    block[4] = ((~length) >> 8) & 0xff;
    block.set(raw.subarray(offset, offset + length), 5);
    blocks.push(block);
    offset += length;
  }

  const checksum = new Uint8Array(4);

  writeUint32(checksum, 0, adler32(raw));

  return concatBytes([new Uint8Array([0x78, 0x01]), ...blocks, checksum]);
}

function pngChunk(type: string, data: Uint8Array) {
  const typeBytes = asciiBytes(type);
  const chunk = new Uint8Array(12 + data.length);
  const crcInput = concatBytes([typeBytes, data]);

  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(crcInput));

  return chunk;
}

function adler32(bytes: Uint8Array) {
  let a = 1;
  let b = 0;

  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }

  return ((b << 16) | a) >>> 0;
}

let crcTable: number[] | null = null;

function crc32(bytes: Uint8Array) {
  const table =
    crcTable ??
    Array.from({ length: 256 }, (_value, index) => {
      let crc = index;

      for (let bit = 0; bit < 8; bit += 1) {
        crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
      }

      return crc >>> 0;
    });

  crcTable = table;

  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint32(target: Uint8Array, offset: number, value: number) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function concatBytes(parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }

  return output;
}

function asciiBytes(value: string) {
  const output = new Uint8Array(value.length);

  for (let index = 0; index < value.length; index += 1) {
    output[index] = value.charCodeAt(index) & 0xff;
  }

  return output;
}

function base64FromBytes(bytes: Uint8Array) {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const triple = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

    output += alphabet[(triple >> 18) & 63];
    output += alphabet[(triple >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[triple & 63] : "=";
  }

  return output;
}

function safeFileSegment(value: string) {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 96) || "image"
  );
}

const toneBorder = {
  cyan: colors.cyan,
  green: colors.green,
  neutral: colors.line,
  pink: colors.pink,
  purple: colors.purple,
  warning: colors.warning
};

const styles = StyleSheet.create({
  approvalCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0
  },
  approvalDetail: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17
  },
  approvalItem: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 58,
    padding: 11
  },
  approvalLabel: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900"
  },
  approvalList: {
    gap: 8
  },
  block: {
    gap: 9
  },
  blockTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900"
  },
  cardDetail: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 16
  },
  cardLabel: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase"
  },
  cardValue: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 26
  },
  dot_cyan: {
    backgroundColor: colors.cyan
  },
  dot_green: {
    backgroundColor: colors.green
  },
  dot_neutral: {
    backgroundColor: colors.muted
  },
  dot_pink: {
    backgroundColor: colors.pink
  },
  dot_purple: {
    backgroundColor: colors.purple
  },
  dot_warning: {
    backgroundColor: colors.warning
  },
  disabled: {
    opacity: 0.45
  },
  generatedList: {
    gap: 8,
    paddingRight: 18
  },
  generatedScroller: {
    height: 198,
    maxHeight: 198
  },
  generatedImage: {
    backgroundColor: colors.surface,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  generatedImageFallback: {
    alignItems: "center",
    backgroundColor: colors.surface,
    gap: 7,
    height: "100%",
    justifyContent: "center",
    padding: 14,
    width: "100%"
  },
  generatedImageFallbackText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 16,
    textAlign: "center"
  },
  generatedImageAction: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32
  },
  generatedImageButton: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.md,
    borderTopRightRadius: radii.md,
    overflow: "hidden",
    width: "100%"
  },
  generatedImageCard: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: "hidden",
    width: 246
  },
  generatedImageEditButton: {
    alignItems: "center",
    backgroundColor: "rgba(8, 9, 13, 0.82)",
    borderColor: "rgba(246, 247, 251, 0.14)",
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    minHeight: 31,
    paddingHorizontal: 10,
    position: "absolute",
    right: 8,
    top: 8
  },
  generatedImageEditText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "900"
  },
  generatedImageMeta: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    minHeight: 48,
    paddingHorizontal: 9,
    paddingVertical: 8
  },
  linkCard: {
    alignItems: "center",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    minHeight: 56,
    paddingHorizontal: 7,
    paddingVertical: 8,
    width: 146
  },
  linkCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0
  },
  linkLabel: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900"
  },
  linkMeta: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 15
  },
  linkRail: {
    gap: 6,
    paddingRight: 14
  },
  linkScroller: {
    maxHeight: 66
  },
  notice: {
    backgroundColor: "rgba(81, 229, 255, 0.07)",
    borderColor: "rgba(81, 229, 255, 0.22)",
    borderLeftColor: colors.cyan,
    borderLeftWidth: 3,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 4,
    padding: 11
  },
  noticeText: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17
  },
  noticeTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900"
  },
  pressed: {
    opacity: 0.72
  },
  previewBackdrop: {
    alignItems: "center",
    backgroundColor: "#000",
    flex: 1,
    height: "100%",
    justifyContent: "center",
    width: "100%"
  },
  previewAnnotationLayer: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  previewAnnotationSvg: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  previewEditActions: {
    flexDirection: "row",
    gap: 9
  },
  previewEditError: {
    color: colors.pink,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17
  },
  previewEditHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between"
  },
  previewEditHint: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginTop: 2
  },
  previewEditInput: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "700",
    minHeight: 86,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: "top"
  },
  previewEditPanel: {
    backgroundColor: "rgba(10, 12, 20, 0.96)",
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: 16,
    borderWidth: 1,
    bottom: 20,
    gap: 12,
    left: 14,
    padding: 13,
    position: "absolute",
    right: 14
  },
  previewEditTitle: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 15,
    fontWeight: "900"
  },
  previewIconButton: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderRadius: radii.pill,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  previewImage: {
    height: "100%",
    width: "100%"
  },
  previewImageFrame: {
    overflow: "hidden",
    position: "absolute"
  },
  previewKeyboard: {
    backgroundColor: "#000",
    flex: 1
  },
  previewPrimaryAction: {
    alignItems: "center",
    backgroundColor: colors.text,
    borderRadius: radii.pill,
    flex: 1,
    flexDirection: "row",
    gap: 7,
    height: 42,
    justifyContent: "center"
  },
  previewPrimaryActionText: {
    color: colors.background,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900"
  },
  previewSecondaryAction: {
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.08)",
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    height: 42,
    justifyContent: "center",
    paddingHorizontal: 14
  },
  previewSecondaryActionText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900"
  },
  previewToolbar: {
    alignItems: "center",
    bottom: 22,
    left: 0,
    position: "absolute",
    right: 0
  },
  previewToolbarButton: {
    alignItems: "center",
    backgroundColor: "rgba(10, 12, 20, 0.88)",
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 17
  },
  previewToolbarIconButton: {
    alignItems: "center",
    backgroundColor: "rgba(10, 12, 20, 0.88)",
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  previewToolbarRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9
  },
  previewToolbarText: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 13,
    fontWeight: "900"
  },
  stack: {
    gap: 10,
    maxWidth: "100%"
  },
  statusText: {
    color: colors.warning,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "900",
    maxWidth: 84,
    textTransform: "uppercase"
  },
  summaryCard: {
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderLeftWidth: 3,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: "48%",
    flexGrow: 1,
    gap: 3,
    minHeight: 88,
    minWidth: 130,
    padding: 11
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  timeline: {
    gap: 8
  },
  timelineCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0
  },
  timelineDetail: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17
  },
  timelineDot: {
    borderRadius: radii.pill,
    height: 9,
    marginTop: 4,
    width: 9
  },
  timelineItem: {
    alignItems: "flex-start",
    backgroundColor: colors.surfaceSoft,
    borderColor: colors.line,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 58,
    padding: 11
  },
  timelineLabel: {
    color: colors.text,
    fontFamily: typography.fontFamily,
    fontSize: 14,
    fontWeight: "900"
  },
  timelineTime: {
    color: colors.muted,
    fontFamily: typography.fontFamily,
    fontSize: 10,
    fontWeight: "800",
    maxWidth: 62,
    textAlign: "right"
  },
  tone_cyan: {
    borderLeftColor: toneBorder.cyan
  },
  tone_green: {
    borderLeftColor: toneBorder.green
  },
  tone_neutral: {
    borderLeftColor: toneBorder.neutral
  },
  tone_pink: {
    borderLeftColor: toneBorder.pink
  },
  tone_purple: {
    borderLeftColor: toneBorder.purple
  },
  tone_warning: {
    borderLeftColor: toneBorder.warning
  }
});
