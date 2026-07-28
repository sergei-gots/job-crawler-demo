"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { CrawlerJob } from "@/entities/crawler-job";
import type { Source } from "@/entities/source";
import { ApiError } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { updateJob } from "../api/update-job";
import { editJobSchema, type EditJobFormValues } from "../model/edit-job-schema";

interface EditJobFormProps {
  job: CrawlerJob;
  sources: Source[];
  token: string;
  onSaved: (job: CrawlerJob) => void;
  onCancel: () => void;
}

export function EditJobForm({ job, sources, token, onSaved, onCancel }: EditJobFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditJobFormValues>({
    resolver: zodResolver(editJobSchema),
    defaultValues: {
      name: job.name,
      description: job.description ?? "",
      sources: job.sources,
      keywords: job.keywords ?? "",
    },
  });

  async function onSubmit(values: EditJobFormValues) {
    setServerError(null);
    try {
      const updated = await updateJob(job.id, values, token);
      onSaved(updated);
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : "Something went wrong");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit crawler job</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-name">Crawler Job Name</Label>
            <Input id="edit-name" {...register("name")} />
            {errors.name && <p className="text-sm text-red-500">{errors.name.message}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-description">Description</Label>
            <Input id="edit-description" {...register("description")} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="edit-keywords">Keywords</Label>
            <Input
              id="edit-keywords"
              placeholder="e.g. typescript, react"
              {...register("keywords")}
            />
            <p className="text-xs text-muted-foreground">
              Matches any of these words in the vacancy&apos;s title, company, or description.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Sources</Label>
            <Controller
              control={control}
              name="sources"
              render={({ field }) => (
                <div className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
                  {sources.map((source) => {
                    const checked = field.value.includes(source.id);
                    return (
                      <label
                        key={source.id}
                        className="flex items-center gap-2 text-sm text-foreground"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => {
                            field.onChange(
                              event.target.checked
                                ? [...field.value, source.id]
                                : field.value.filter((id) => id !== source.id),
                            );
                          }}
                        />
                        {source.name}
                      </label>
                    );
                  })}
                </div>
              )}
            />
            {errors.sources && <p className="text-sm text-red-500">{errors.sources.message}</p>}
          </div>

          {serverError && <p className="text-sm text-red-500">{serverError}</p>}

          <div className="flex gap-2">
            <Button type="submit" disabled={isSubmitting} className="w-fit">
              {isSubmitting ? "Saving..." : "Save"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isSubmitting}
              className="w-fit"
              onClick={onCancel}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
