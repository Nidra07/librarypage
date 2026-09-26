'use client'

import { FormEvent, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'

type Story = {
  id: string
  student_name: string
  photo_url: string | null
  job_title: string
  organization: string
  department: string | null
  exam_name: string
  selection_year: number
  preparation_duration: string | null
  testimonial: string | null
  success_story: string | null
  display_order: number
  published: boolean
  student_consent: boolean
}

const blank = {
  student_name: '',
  photo_url: '',
  job_title: '',
  organization: '',
  department: '',
  exam_name: '',
  selection_year: new Date().getFullYear(),
  preparation_duration: '',
  testimonial: '',
  success_story: '',
  display_order: 0,
  published: false,
  student_consent: false,
}

export default function AdminDashboard() {
  const supabase = createClient()

  const [stories, setStories] = useState<Story[]>([])
  const [form, setForm] = useState(blank)
  const [editing, setEditing] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)

    const { data, error } = await supabase
      .from('government_job_achievers')
      .select('*')
      .order('display_order')
      .order('selection_year', { ascending: false })

    if (error) {
      setMessage(error.message)
      setStories([])
    } else {
      setStories((data ?? []) as Story[])
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  function update(
    key: keyof typeof blank,
    value: string | number | boolean
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }))
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    setSaving(true)
    setMessage('')

    const payload = {
      ...form,
      photo_url: form.photo_url || null,
      department: form.department || null,
      preparation_duration: form.preparation_duration || null,
      testimonial: form.testimonial || null,
      success_story: form.success_story || null,
    }

    const result = editing
      ? await supabase
          .from('government_job_achievers')
          .update(payload)
          .eq('id', editing)
      : await supabase
          .from('government_job_achievers')
          .insert(payload)

    if (result.error) {
      setMessage(result.error.message)
      setSaving(false)
      return
    }

    setForm(blank)
    setEditing(null)
    setMessage(
      editing
        ? 'Success story updated successfully.'
        : 'Success story added successfully.'
    )

    await load()

    setSaving(false)
  }

  function edit(story: Story) {
    setEditing(story.id)

    setForm({
      student_name: story.student_name,
      photo_url: story.photo_url ?? '',
      job_title: story.job_title,
      organization: story.organization,
      department: story.department ?? '',
      exam_name: story.exam_name,
      selection_year: story.selection_year,
      preparation_duration: story.preparation_duration ?? '',
      testimonial: story.testimonial ?? '',
      success_story: story.success_story ?? '',
      display_order: story.display_order,
      published: story.published,
      student_consent: story.student_consent,
    })

    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    })
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this success story?')) {
      return
    }

    setMessage('')

    const { error } = await supabase
      .from('government_job_achievers')
      .delete()
      .eq('id', id)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('Success story deleted.')
    await load()
  }

  function cancelEdit() {
    setEditing(null)
    setForm(blank)
    setMessage('')
  }

  return (
    <main className="member-page admin-page">
      <div className="admin-wrap">

        <div className="admin-heading">
          <div>
            <span className="eyebrow">
              Admin portal
            </span>

            <h1>
              Success stories
            </h1>

            <p>
              Publish verified government job achievers
              from The Peaceful Pages.
            </p>
          </div>

          <Link
            href="/admin"
            className="text-button"
          >
            Back to admin dashboard →
          </Link>
        </div>

        <div className="admin-grid">

          <form
            className="admin-form"
            onSubmit={save}
          >
            <h2>
              {editing ? 'Edit achiever' : 'Add achiever'}
            </h2>

            <label>
              Student name
              <input
                value={form.student_name}
                onChange={(event) =>
                  update(
                    'student_name',
                    event.target.value
                  )
                }
                required
              />
            </label>

            <label>
              Photo URL
              <input
                value={form.photo_url}
                onChange={(event) =>
                  update(
                    'photo_url',
                    event.target.value
                  )
                }
                placeholder="https://..."
              />
            </label>

            <label>
              Government job / post
              <input
                value={form.job_title}
                onChange={(event) =>
                  update(
                    'job_title',
                    event.target.value
                  )
                }
                required
              />
            </label>

            <label>
              Organization
              <input
                value={form.organization}
                onChange={(event) =>
                  update(
                    'organization',
                    event.target.value
                  )
                }
                required
              />
            </label>

            <label>
              Department
              <input
                value={form.department}
                onChange={(event) =>
                  update(
                    'department',
                    event.target.value
                  )
                }
              />
            </label>

            <label>
              Exam name
              <input
                value={form.exam_name}
                onChange={(event) =>
                  update(
                    'exam_name',
                    event.target.value
                  )
                }
                required
              />
            </label>

            <label>
              Preparation duration
              <input
                value={form.preparation_duration}
                onChange={(event) =>
                  update(
                    'preparation_duration',
                    event.target.value
                  )
                }
                placeholder="e.g. 2 years"
              />
            </label>

            <label>
              Testimonial
              <textarea
                value={form.testimonial}
                onChange={(event) =>
                  update(
                    'testimonial',
                    event.target.value
                  )
                }
                rows={4}
              />
            </label>

            <label>
              Detailed success story
              <textarea
                value={form.success_story}
                onChange={(event) =>
                  update(
                    'success_story',
                    event.target.value
                  )
                }
                rows={7}
              />
            </label>

            <div className="admin-two">

              <label>
                Selection year
                <input
                  type="number"
                  value={form.selection_year}
                  onChange={(event) =>
                    update(
                      'selection_year',
                      Number(event.target.value)
                    )
                  }
                />
              </label>

              <label>
                Display order
                <input
                  type="number"
                  value={form.display_order}
                  onChange={(event) =>
                    update(
                      'display_order',
                      Number(event.target.value)
                    )
                  }
                />
              </label>

            </div>

            <label className="check-row">
              <input
                type="checkbox"
                checked={form.student_consent}
                onChange={(event) =>
                  update(
                    'student_consent',
                    event.target.checked
                  )
                }
              />

              Student consent obtained
            </label>

            <label className="check-row">
              <input
                type="checkbox"
                checked={form.published}
                onChange={(event) =>
                  update(
                    'published',
                    event.target.checked
                  )
                }
              />

              Publish on website
            </label>

            <div className="admin-actions">

              <button
                className="primary-button"
                type="submit"
                disabled={saving}
              >
                {saving
                  ? 'Saving…'
                  : editing
                    ? 'Update story'
                    : 'Add story'}
              </button>

              {editing && (
                <button
                  type="button"
                  className="text-button"
                  onClick={cancelEdit}
                >
                  Cancel
                </button>
              )}

            </div>

            {message && (
              <p
                className="admin-message"
                role="status"
              >
                {message}
              </p>
            )}

          </form>

          <section className="admin-list">

            <h2>
              Published and draft stories
            </h2>

            {loading ? (
              <p className="admin-empty">
                Loading stories…
              </p>
            ) : stories.length ? (

              stories.map((story) => (

                <article
                  className="admin-story"
                  key={story.id}
                >

                  <div>
                    <strong>
                      {story.student_name}
                    </strong>

                    <span>
                      {story.job_title} ·{' '}
                      {story.selection_year}
                    </span>

                    <small>
                      {story.published &&
                      story.student_consent
                        ? 'Published'
                        : 'Draft / consent needed'}
                    </small>
                  </div>

                  <div>

                    <button
                      type="button"
                      onClick={() => edit(story)}
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => remove(story.id)}
                    >
                      Delete
                    </button>

                  </div>

                </article>

              ))

            ) : (

              <p className="admin-empty">
                No achievers added yet.
              </p>

            )}

          </section>

        </div>

      </div>
    </main>
  )
}
