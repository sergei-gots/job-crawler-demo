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
import { createJob } from "../api/create-job";
import { createJobSchema, type CreateJobFormValues } from "../model/create-job-schema";

interface CreateJobFormProps {
  sources: Source[];
  token: string;
  onCreated: (job: CrawlerJob) => void;
}

export function CreateJobForm({ sources, token, onCreated }: CreateJobFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateJobFormValues>({
    resolver: zodResolver(createJobSchema),
    defaultValues: { name: "", description: "", sources: [], keywords: "" },
  });

  async function onSubmit(values: CreateJobFormValues) {
    setServerError(null);
    try {
      const job = await createJob(values, token);
      onCreated(job);
      reset();
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : "Something went wrong");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create crawler job</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Job name</Label>
            <Input id="name" {...register("name")} />
            {errors.name && <p className="text-sm text-red-500">{errors.name.message}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="description">Description</Label>
            <Input id="description" {...register("description")} />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="keywords">Keywords</Label>
            <Input id="keywords" placeholder="e.g. typescript, react" {...register("keywords")} />
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

          <Button type="submit" disabled={isSubmitting} className="w-fit">
            {isSubmitting ? "Creating..." : "Create job"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
