import { supabase } from "./supabase";

const BUCKET = "test_steps";

const getExt = (file: File) => {
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext || "jpg";
};

export const uploadActionImages = async (
  stepId: string,
  files: File[]
): Promise<string[]> => {
  const paths: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const oddNumber = i * 2 + 1;
    const filePath = `${stepId}_${oddNumber}.${getExt(files[i])}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, files[i], { upsert: true });

    if (error) throw error;

    paths.push(filePath);
  }

  return paths;
};

export const uploadExpectedImages = async (
  stepId: string,
  files: File[]
): Promise<string[]> => {
  const paths: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const evenNumber = (i + 1) * 2;
    const filePath = `${stepId}_${evenNumber}.${getExt(files[i])}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, files[i], { upsert: true });

    if (error) throw error;

    paths.push(filePath);
  }

  return paths;
};

export const deleteStepImages = async (paths: string[]) => {
  if (!paths.length) return;

  const { error } = await supabase.storage
    .from(BUCKET)
    .remove(paths);

  if (error) throw error;
};

export const getSignedImageUrl = async (path: string) => {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (error) throw error;

  return data.signedUrl;
};

export const getSignedImageUrls = async (paths: string[]) => {
  return Promise.all(paths.map((path) => getSignedImageUrl(path)));
};