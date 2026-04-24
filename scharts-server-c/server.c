#define _POSIX_C_SOURCE 200112L

#include <arpa/inet.h>
#include <ctype.h>
#include <errno.h>
#include <float.h>
#include <math.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/types.h>
#include <unistd.h>

#define SERVER_DEFAULT_PORT 8080
#define STREAM_INTERVAL_MS 100.0
#define DEFAULT_SAMPLE_COUNT 96UL
#define REQUEST_BUFFER_MAX 65536UL
#define HEADER_BUFFER_MAX 16384UL
#define MAX_CLIENTS 1024
#define LISTEN_BACKLOG 64
#define DATASET_COUNT 2
#define DATASET_ALPHA 0
#define DATASET_CLUSTERS 1
#define MODE_LINE 1
#define MODE_SCATTER 2
#define MESSAGE_SUBSCRIBE 0
#define MESSAGE_DATA 1
#define SCHARTS_PI 3.14159265358979323846

typedef struct {
    const char *key;
    int mode;
    double x_min;
    double x_max;
    double y_min;
    double y_max;
    unsigned long cycle_length;
    unsigned long total_points;
} Dataset;

typedef struct {
    double x;
    double y;
} Point;

typedef struct {
    Point *points;
    unsigned long count;
    unsigned long capacity;
} PointBatch;

typedef struct {
    int initialized;
    int mode;
    unsigned long cycle_length;
    unsigned long total_points;
    PointBatch *batches;
} SeriesState;

typedef struct {
    unsigned long subscription_id;
    char key[256];
    int include_x;
    double x_min;
    double x_max;
    int x_bits;
    double y_min;
    double y_max;
    int y_bits;
    int dataset_index;
} Subscription;

typedef struct {
    Point *points;
    unsigned long count;
    double x_offset;
    int has_x_offset;
    int owns_points;
} BatchView;

typedef struct {
    unsigned char *data;
    unsigned long length;
} ByteBuffer;

typedef struct {
    unsigned char *bytes;
    unsigned long bit_offset;
} BitWriter;

typedef struct {
    unsigned long state;
} Rng;

typedef enum {
    CONN_READING = 1,
    CONN_STREAMING = 2
} ConnState;

typedef struct {
    int active;
    int fd;
    ConnState state;
    unsigned char request[REQUEST_BUFFER_MAX];
    unsigned long request_len;
    Subscription *subscriptions;
    unsigned long subscription_count;
} Client;

typedef struct {
    const char *path;
    const char *file;
    const char *content_type;
} StaticFile;

static const Dataset datasets[DATASET_COUNT] = {
    {
        "alpha",
        MODE_LINE,
        0.0,
        60000.0,
        -2.0,
        2.0,
        600UL,
        60000UL
    },
    {
        "clusters",
        MODE_SCATTER,
        0.0,
        3000000000.0,
        -0.1,
        1.1,
        600UL,
        0UL
    }
};

static const StaticFile static_files[] = {
    { "/", "index.html", "text/html; charset=utf-8" },
    { "/index.html", "index.html", "text/html; charset=utf-8" },
    { "/chart-base.js", "chart-base.js", "text/javascript; charset=utf-8" },
    { "/demo-datasets.js", "demo-datasets.js", "text/javascript; charset=utf-8" },
    { "/schart-line.js", "schart-line.js", "text/javascript; charset=utf-8" },
    { "/schart-scatter.js", "schart-scatter.js", "text/javascript; charset=utf-8" },
    { "/browser-client.js", "browser-client.js", "text/javascript; charset=utf-8" },
    { "/client-core.js", "client-core.js", "text/javascript; charset=utf-8" },
    { "/protocol.js", "protocol.js", "text/javascript; charset=utf-8" },
    { 0, 0, 0 }
};

static Client clients[MAX_CLIENTS];
static SeriesState source_states[DATASET_COUNT];
static unsigned long global_tick = 0UL;
static char static_root[1024] = ".";

static double clamp_double(double value, double min, double max)
{
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}

static unsigned long mask32(unsigned long value)
{
    return value & 0xffffffffUL;
}

static int finite_double(double value)
{
    return value == value && value <= DBL_MAX && value >= -DBL_MAX;
}

static unsigned long read_u32_le(const unsigned char *bytes)
{
    unsigned long value;

    value = (unsigned long)bytes[0];
    value |= ((unsigned long)bytes[1]) << 8;
    value |= ((unsigned long)bytes[2]) << 16;
    value |= ((unsigned long)bytes[3]) << 24;
    return value;
}

static void write_u32_le(unsigned char *bytes, unsigned long value)
{
    bytes[0] = (unsigned char)(value & 0xffUL);
    bytes[1] = (unsigned char)((value >> 8) & 0xffUL);
    bytes[2] = (unsigned char)((value >> 16) & 0xffUL);
    bytes[3] = (unsigned char)((value >> 24) & 0xffUL);
}

static int host_is_little_endian(void)
{
    unsigned long value;
    unsigned char *bytes;

    value = 1UL;
    bytes = (unsigned char *)&value;
    return bytes[0] == 1U;
}

static double read_f64_le(const unsigned char *bytes)
{
    double value;
    unsigned char temp[8];
    int i;

    if (host_is_little_endian()) {
        memcpy(&value, bytes, 8);
    } else {
        for (i = 0; i < 8; i += 1) {
            temp[i] = bytes[7 - i];
        }
        memcpy(&value, temp, 8);
    }
    return value;
}

static void write_f64_le(unsigned char *bytes, double value)
{
    unsigned char temp[8];
    int i;

    memcpy(temp, &value, 8);
    if (host_is_little_endian()) {
        memcpy(bytes, temp, 8);
    } else {
        for (i = 0; i < 8; i += 1) {
            bytes[i] = temp[7 - i];
        }
    }
}

static unsigned long create_seed(const char *key)
{
    unsigned long hash;
    const unsigned char *p;

    hash = 0x811c9dc5UL;
    p = (const unsigned char *)key;
    while (*p) {
        hash = mask32((hash * 31UL) + (unsigned long)*p);
        p += 1;
    }
    return hash;
}

static void rng_init(Rng *rng, unsigned long seed)
{
    rng->state = mask32(seed);
}

static double rng_next(Rng *rng)
{
    rng->state = mask32((rng->state * 1664525UL) + 1013904223UL);
    return (double)rng->state / 4294967296.0;
}

static double sample_clustered_y(const Dataset *dataset, Rng *rng)
{
    double centers[3];
    double center;
    double noise;
    int index;

    centers[0] = 0.0;
    centers[1] = 0.5;
    centers[2] = 1.0;
    index = (int)floor(rng_next(rng) * 3.0);
    if (index < 0) {
        index = 0;
    }
    if (index > 2) {
        index = 2;
    }
    center = centers[index];
    noise = (((rng_next(rng) + rng_next(rng) + rng_next(rng)) / 3.0) - 0.5) * 0.12;
    return clamp_double(center + noise, dataset->y_min, dataset->y_max);
}

static int compare_points_x(const void *left, const void *right)
{
    const Point *a;
    const Point *b;

    a = (const Point *)left;
    b = (const Point *)right;
    if (a->x < b->x) {
        return -1;
    }
    if (a->x > b->x) {
        return 1;
    }
    return 0;
}

static int reserve_batch(PointBatch *batch, unsigned long capacity)
{
    Point *points;

    if (capacity <= batch->capacity) {
        return 0;
    }
    points = (Point *)realloc(batch->points, capacity * sizeof(Point));
    if (!points) {
        return -1;
    }
    batch->points = points;
    batch->capacity = capacity;
    return 0;
}

static int append_point(PointBatch *batch, double x, double y)
{
    unsigned long next_capacity;

    if (batch->count == batch->capacity) {
        next_capacity = batch->capacity == 0UL ? 1024UL : batch->capacity * 2UL;
        if (reserve_batch(batch, next_capacity) != 0) {
            return -1;
        }
    }
    batch->points[batch->count].x = x;
    batch->points[batch->count].y = y;
    batch->count += 1UL;
    return 0;
}

static void free_scatter_batches(PointBatch *batches, unsigned long count)
{
    unsigned long i;

    if (!batches) {
        return;
    }
    for (i = 0UL; i < count; i += 1UL) {
        free(batches[i].points);
    }
    free(batches);
}

static int create_scatter_batches(const Dataset *dataset, PointBatch **out_batches)
{
    PointBatch *batches;
    Rng rng;
    double span;
    double target_double;
    unsigned long target_total;
    unsigned long batch_count;
    unsigned long base_capacity;
    unsigned long index;
    unsigned long i;

    span = dataset->x_max - dataset->x_min;
    target_double = floor((span / 100.0) + 0.5);
    if (target_double < 1.0) {
        target_double = 1.0;
    }
    target_total = (unsigned long)target_double;
    batch_count = dataset->cycle_length;

    batches = (PointBatch *)calloc(batch_count, sizeof(PointBatch));
    if (!batches) {
        return -1;
    }

    base_capacity = (target_total / batch_count) + 128UL;
    for (i = 0UL; i < batch_count; i += 1UL) {
        if (reserve_batch(&batches[i], base_capacity) != 0) {
            free_scatter_batches(batches, batch_count);
            return -1;
        }
    }

    rng_init(&rng, create_seed(dataset->key));

    for (index = 0UL; index < target_total; index += 1UL) {
        double t;
        double step;
        double jitter;
        double x;
        double normalized;
        double batch_index_double;
        unsigned long batch_index;
        double y;

        t = target_total <= 1UL ? 0.5 : (double)index / (double)(target_total - 1UL);
        step = span / (double)(target_total <= 1UL ? 1UL : target_total - 1UL);
        jitter = (rng_next(&rng) - 0.5) * step * 0.35;
        x = clamp_double(dataset->x_min + (t * span) + jitter, dataset->x_min, dataset->x_max);
        normalized = (x - dataset->x_min) / (span == 0.0 ? 1.0 : span);
        batch_index_double = floor(normalized * (double)batch_count);
        if (batch_index_double < 0.0) {
            batch_index = 0UL;
        } else if (batch_index_double > (double)(batch_count - 1UL)) {
            batch_index = batch_count - 1UL;
        } else {
            batch_index = (unsigned long)batch_index_double;
        }
        y = sample_clustered_y(dataset, &rng);
        if (append_point(&batches[batch_index], x, y) != 0) {
            free_scatter_batches(batches, batch_count);
            return -1;
        }
    }

    for (i = 0UL; i < batch_count; i += 1UL) {
        qsort(batches[i].points, (size_t)batches[i].count, sizeof(Point), compare_points_x);
    }

    *out_batches = batches;
    return 0;
}

static int ensure_source_state(int dataset_index)
{
    SeriesState *state;
    const Dataset *dataset;

    state = &source_states[dataset_index];
    if (state->initialized) {
        return 0;
    }

    dataset = &datasets[dataset_index];
    state->mode = dataset->mode;
    state->cycle_length = dataset->cycle_length;
    state->total_points = dataset->total_points;

    if (dataset->mode == MODE_SCATTER) {
        fprintf(stderr, "Preparing scatter dataset '%s'...\n", dataset->key);
        if (create_scatter_batches(dataset, &state->batches) != 0) {
            return -1;
        }
    }

    state->initialized = 1;
    return 0;
}

static int dataset_index_for_key(const char *key)
{
    int i;

    for (i = 0; i < DATASET_COUNT; i += 1) {
        if (strcmp(datasets[i].key, key) == 0) {
            return i;
        }
    }
    return -1;
}

static void set_error(char *error, unsigned long error_size, const char *message)
{
    unsigned long i;

    if (error_size == 0UL) {
        return;
    }
    for (i = 0UL; i + 1UL < error_size && message[i]; i += 1UL) {
        error[i] = message[i];
    }
    error[i] = '\0';
}

static int key_is_valid(const char *key)
{
    const unsigned char *p;

    if (!key[0]) {
        return 0;
    }
    p = (const unsigned char *)key;
    while (*p) {
        if (!isalnum(*p) && *p != '_' && *p != '-') {
            return 0;
        }
        p += 1;
    }
    return 1;
}

static int validate_subscription(Subscription *subscription, char *error, unsigned long error_size)
{
    int dataset_index;
    char message[512];

    if (subscription->subscription_id > 0xffffffffUL) {
        sprintf(message, "Invalid subscription id: %lu", subscription->subscription_id);
        set_error(error, error_size, message);
        return -1;
    }
    if (!key_is_valid(subscription->key)) {
        sprintf(message, "Invalid key: %s", subscription->key);
        set_error(error, error_size, message);
        return -1;
    }
    if (!finite_double(subscription->y_min) ||
        !finite_double(subscription->y_max) ||
        subscription->y_min >= subscription->y_max) {
        sprintf(message, "Invalid y range for %s", subscription->key);
        set_error(error, error_size, message);
        return -1;
    }
    if (subscription->y_bits < 1 || subscription->y_bits > 32) {
        sprintf(message, "Invalid bit width for %s", subscription->key);
        set_error(error, error_size, message);
        return -1;
    }
    if (subscription->include_x) {
        if (!finite_double(subscription->x_min) ||
            !finite_double(subscription->x_max) ||
            subscription->x_min >= subscription->x_max) {
            sprintf(message, "Invalid x range for %s", subscription->key);
            set_error(error, error_size, message);
            return -1;
        }
        if (subscription->x_bits < 1 || subscription->x_bits > 32) {
            sprintf(message, "Invalid x bit width for %s", subscription->key);
            set_error(error, error_size, message);
            return -1;
        }
    }

    dataset_index = dataset_index_for_key(subscription->key);
    if (dataset_index < 0) {
        sprintf(message, "Unknown demo dataset: %s", subscription->key);
        set_error(error, error_size, message);
        return -1;
    }
    subscription->dataset_index = dataset_index;
    return 0;
}

static int decode_subscribe_message(const unsigned char *bytes,
                                    unsigned long length,
                                    Subscription *subscription,
                                    char *error,
                                    unsigned long error_size)
{
    unsigned long offset;
    unsigned int key_length;

    memset(subscription, 0, sizeof(*subscription));

    if (length < 6UL) {
        set_error(error, error_size, "Subscribe message is too short");
        return -1;
    }
    if (bytes[0] != MESSAGE_SUBSCRIBE) {
        set_error(error, error_size, "Unexpected subscribe message type");
        return -1;
    }

    subscription->subscription_id = read_u32_le(bytes + 1UL);
    offset = 5UL;

    if (offset + 1UL > length) {
        set_error(error, error_size, "Truncated subscription key length");
        return -1;
    }
    key_length = bytes[offset];
    offset += 1UL;
    if (offset + (unsigned long)key_length + 1UL > length) {
        set_error(error, error_size, "Truncated subscription key");
        return -1;
    }
    memcpy(subscription->key, bytes + offset, (size_t)key_length);
    subscription->key[key_length] = '\0';
    offset += (unsigned long)key_length;

    subscription->include_x = bytes[offset] == 1U ? 1 : 0;
    offset += 1UL;

    if (subscription->include_x) {
        if (offset + 17UL > length) {
            set_error(error, error_size, "Truncated x subscription fields");
            return -1;
        }
        subscription->x_min = read_f64_le(bytes + offset);
        subscription->x_max = read_f64_le(bytes + offset + 8UL);
        subscription->x_bits = bytes[offset + 16UL];
        offset += 17UL;
    }

    if (offset + 17UL > length) {
        set_error(error, error_size, "Truncated y subscription fields");
        return -1;
    }
    subscription->y_min = read_f64_le(bytes + offset);
    subscription->y_max = read_f64_le(bytes + offset + 8UL);
    subscription->y_bits = bytes[offset + 16UL];

    return validate_subscription(subscription, error, error_size);
}

static long subscription_index_for_id(Subscription *items,
                                      unsigned long count,
                                      unsigned long subscription_id)
{
    unsigned long i;

    for (i = 0UL; i < count; i += 1UL) {
        if (items[i].subscription_id == subscription_id) {
            return (long)i;
        }
    }
    return -1L;
}

static int append_or_replace_subscription(Subscription **items,
                                          unsigned long *count,
                                          unsigned long *capacity,
                                          const Subscription *subscription,
                                          char *error,
                                          unsigned long error_size)
{
    long existing_index;
    Subscription *next_items;
    unsigned long next_capacity;

    existing_index = subscription_index_for_id(*items, *count, subscription->subscription_id);
    if (existing_index >= 0L) {
        (*items)[existing_index] = *subscription;
        return 0;
    }

    if (*count == *capacity) {
        next_capacity = *capacity == 0UL ? 4UL : *capacity * 2UL;
        next_items = (Subscription *)realloc(*items, (size_t)(next_capacity * sizeof(Subscription)));
        if (!next_items) {
            set_error(error, error_size, "Out of memory");
            return -1;
        }
        *items = next_items;
        *capacity = next_capacity;
    }

    (*items)[*count] = *subscription;
    *count += 1UL;
    return 0;
}

static int decode_subscribe_messages(const unsigned char *bytes,
                                     unsigned long length,
                                     Subscription **out_items,
                                     unsigned long *out_count,
                                     char *error,
                                     unsigned long error_size)
{
    unsigned long offset;
    unsigned long count;
    unsigned long capacity;
    Subscription *items;

    offset = 0UL;
    count = 0UL;
    capacity = 0UL;
    items = 0;

    while (offset + 4UL <= length) {
        unsigned long frame_size;
        Subscription subscription;

        frame_size = read_u32_le(bytes + offset);
        offset += 4UL;
        if (frame_size > length - offset) {
            free(items);
            set_error(error, error_size, "Incomplete subscribe message");
            return -1;
        }

        if (decode_subscribe_message(bytes + offset,
                                     frame_size,
                                     &subscription,
                                     error,
                                     error_size) != 0) {
            free(items);
            return -1;
        }

        if (append_or_replace_subscription(&items,
                                           &count,
                                           &capacity,
                                           &subscription,
                                           error,
                                           error_size) != 0) {
            free(items);
            return -1;
        }

        offset += frame_size;
    }

    if (offset != length) {
        free(items);
        set_error(error, error_size, "Incomplete subscribe message");
        return -1;
    }

    if (count == 0UL) {
        free(items);
        set_error(error, error_size, "No subscribe messages");
        return -1;
    }

    *out_items = items;
    *out_count = count;
    return 0;
}

static unsigned long name_factor_for_key(const char *key)
{
    unsigned long sum;
    const unsigned char *p;

    sum = 0UL;
    p = (const unsigned char *)key;
    while (*p) {
        sum += (unsigned long)*p;
        p += 1;
    }
    return sum;
}

static int generate_line_series_points(const Dataset *dataset,
                                       unsigned long tick,
                                       unsigned long sample_count,
                                       BatchView *batch)
{
    Point *points;
    double phase;
    double center;
    double amplitude;
    unsigned long name_factor;
    unsigned long frequency;
    unsigned long i;

    points = (Point *)malloc((size_t)sample_count * sizeof(Point));
    if (!points) {
        return -1;
    }

    phase = (double)tick / 6.0;
    center = (dataset->y_min + dataset->y_max) / 2.0;
    amplitude = (dataset->y_max - dataset->y_min) * 0.42;
    name_factor = name_factor_for_key(dataset->key);
    frequency = 1UL + (name_factor % 5UL);

    for (i = 0UL; i < sample_count; i += 1UL) {
        double t;
        double x;
        double wave;
        double wobble;

        t = sample_count <= 1UL ? 0.0 : (double)i / (double)(sample_count - 1UL);
        x = dataset->x_min + (((dataset->x_max - dataset->x_min) == 0.0 ? 1.0 : (dataset->x_max - dataset->x_min)) * t);
        wave = sin((t * SCHARTS_PI * 2.0 * (double)frequency) + phase);
        wobble = cos((t * SCHARTS_PI * 8.0) - (phase * 0.7)) * amplitude * 0.16;
        points[i].x = x;
        points[i].y = center + (wave * amplitude) + wobble;
    }

    batch->points = points;
    batch->count = sample_count;
    batch->x_offset = 0.0;
    batch->has_x_offset = 0;
    batch->owns_points = 1;
    return 0;
}

static int generate_line_series_batch(const Dataset *dataset,
                                      SeriesState *state,
                                      unsigned long tick,
                                      BatchView *batch)
{
    unsigned long cycle_tick;
    unsigned long batch_size;
    unsigned long start_index;
    unsigned long end_index;
    unsigned long count;
    unsigned long name_factor;
    unsigned long frequency;
    unsigned long output_index;
    unsigned long index;
    Point *points;
    double phase;
    double center;
    double amplitude;

    cycle_tick = tick % state->cycle_length;
    batch_size = (state->total_points + state->cycle_length - 1UL) / state->cycle_length;
    start_index = cycle_tick * batch_size;
    end_index = start_index + batch_size;
    if (end_index > state->total_points) {
        end_index = state->total_points;
    }
    count = end_index > start_index ? end_index - start_index : 0UL;

    points = (Point *)malloc((size_t)(count == 0UL ? 1UL : count) * sizeof(Point));
    if (!points) {
        return -1;
    }

    phase = (double)tick / 6.0;
    center = (dataset->y_min + dataset->y_max) / 2.0;
    amplitude = (dataset->y_max - dataset->y_min) * 0.42;
    name_factor = name_factor_for_key(dataset->key);
    frequency = 1UL + (name_factor % 5UL);

    output_index = 0UL;
    for (index = start_index; index < end_index; index += 1UL) {
        double x;
        double t;
        double wave;
        double wobble;

        x = (double)(start_index + (index - start_index));
        t = dataset->x_max == dataset->x_min ? 0.0 : (x - dataset->x_min) / (dataset->x_max - dataset->x_min);
        wave = sin((t * SCHARTS_PI * 2.0 * (double)frequency) + phase);
        wobble = cos((t * SCHARTS_PI * 8.0) - (phase * 0.7)) * amplitude * 0.16;
        points[output_index].x = -HUGE_VAL;
        points[output_index].y = center + (wave * amplitude) + wobble;
        output_index += 1UL;
    }

    batch->points = points;
    batch->count = count;
    batch->x_offset = (double)start_index;
    batch->has_x_offset = 1;
    batch->owns_points = 1;
    return 0;
}

static int generate_series_batch(const Dataset *dataset,
                                 SeriesState *state,
                                 unsigned long tick,
                                 unsigned long sample_count,
                                 BatchView *batch)
{
    unsigned long batch_index;

    memset(batch, 0, sizeof(*batch));

    if (state->mode == MODE_SCATTER) {
        batch_index = tick % state->cycle_length;
        batch->points = state->batches[batch_index].points;
        batch->count = state->batches[batch_index].count;
        batch->x_offset = 0.0;
        batch->has_x_offset = 0;
        batch->owns_points = 0;
        return 0;
    }

    if (state->mode == MODE_LINE && state->total_points) {
        return generate_line_series_batch(dataset, state, tick, batch);
    }

    return generate_line_series_points(dataset, tick, sample_count, batch);
}

static void free_batch_view(BatchView *batch)
{
    if (batch->owns_points) {
        free(batch->points);
    }
    memset(batch, 0, sizeof(*batch));
}

static unsigned long quantize_value(double value, double min, double max, int bits)
{
    double max_int;
    double safe_value;
    double safe_min;
    double safe_max;
    double bounded;
    double ratio;
    double quantized;

    max_int = ldexp(1.0, bits) - 1.0;
    safe_value = value == value ? value : -HUGE_VAL;
    safe_min = min == min ? min : -HUGE_VAL;
    safe_max = max == max ? max : -HUGE_VAL;
    bounded = clamp_double(safe_value, safe_min, safe_max);

    if (safe_max == safe_min) {
        return 0UL;
    }

    ratio = (bounded - safe_min) / (safe_max - safe_min);
    quantized = floor((ratio * max_int) + 0.5);
    if (!(quantized == quantized) || quantized < 0.0) {
        quantized = 0.0;
    }
    if (quantized > max_int) {
        quantized = max_int;
    }
    return (unsigned long)quantized;
}

static void bit_writer_write(BitWriter *writer, unsigned long value, int bits)
{
    int i;

    for (i = bits - 1; i >= 0; i -= 1) {
        unsigned long bit;
        unsigned long byte_index;
        int bit_index;

        bit = (value >> i) & 1UL;
        byte_index = writer->bit_offset >> 3;
        bit_index = 7 - (int)(writer->bit_offset & 7UL);
        writer->bytes[byte_index] = (unsigned char)(writer->bytes[byte_index] | (unsigned char)(bit << bit_index));
        writer->bit_offset += 1UL;
    }
}

static int encode_data_message(const Subscription *subscription,
                               unsigned long subscription_id,
                               const BatchView *batch,
                               ByteBuffer *out)
{
    int include_x_offset;
    unsigned long bits_per_sample;
    unsigned long bit_count;
    unsigned long payload_length;
    unsigned long header_size;
    unsigned long total_size;
    unsigned long i;
    unsigned long offset;
    unsigned char *bytes;
    BitWriter writer;

    include_x_offset = !subscription->include_x &&
        batch->has_x_offset &&
        finite_double(batch->x_offset);
    bits_per_sample = subscription->include_x ?
        (unsigned long)(subscription->x_bits + subscription->y_bits) :
        (unsigned long)subscription->y_bits;
    bit_count = batch->count * bits_per_sample;
    payload_length = (bit_count + 7UL) / 8UL;
    header_size = 11UL + (include_x_offset ? 8UL : 0UL);
    total_size = header_size + payload_length;

    bytes = (unsigned char *)calloc((size_t)(total_size == 0UL ? 1UL : total_size), 1U);
    if (!bytes) {
        return -1;
    }

    bytes[0] = MESSAGE_DATA;
    write_u32_le(bytes + 1UL, subscription_id);
    write_u32_le(bytes + 5UL, batch->count);
    bytes[9] = (unsigned char)(subscription->include_x ? 1U : 0U);
    bytes[10] = (unsigned char)(include_x_offset ? 1U : 0U);
    offset = 11UL;
    if (include_x_offset) {
        write_f64_le(bytes + offset, batch->x_offset);
        offset += 8UL;
    }

    writer.bytes = bytes + offset;
    writer.bit_offset = 0UL;
    for (i = 0UL; i < batch->count; i += 1UL) {
        if (subscription->include_x) {
            bit_writer_write(&writer,
                             quantize_value(batch->points[i].x,
                                            subscription->x_min,
                                            subscription->x_max,
                                            subscription->x_bits),
                             subscription->x_bits);
        }
        bit_writer_write(&writer,
                         quantize_value(batch->points[i].y,
                                        subscription->y_min,
                                        subscription->y_max,
                                        subscription->y_bits),
                         subscription->y_bits);
    }

    out->data = bytes;
    out->length = total_size;
    return 0;
}

static void free_byte_buffer(ByteBuffer *buffer)
{
    free(buffer->data);
    buffer->data = 0;
    buffer->length = 0UL;
}

static int send_all(int fd, const void *data, unsigned long length)
{
    const unsigned char *bytes;
    unsigned long offset;

    bytes = (const unsigned char *)data;
    offset = 0UL;
    while (offset < length) {
        ssize_t written;

        written = send(fd, bytes + offset, (size_t)(length - offset), 0);
        if (written < 0) {
            if (errno == EINTR) {
                continue;
            }
            return -1;
        }
        if (written == 0) {
            return -1;
        }
        offset += (unsigned long)written;
    }
    return 0;
}

static int send_framed_message_chunk(int fd, const ByteBuffer *message)
{
    unsigned char prefix[4];
    unsigned long frame_length;
    char chunk_header[64];
    char trailer[2];
    int header_length;

    frame_length = message->length + 4UL;
    write_u32_le(prefix, message->length);
    header_length = sprintf(chunk_header, "%lX\r\n", frame_length);
    trailer[0] = '\r';
    trailer[1] = '\n';

    if (send_all(fd, chunk_header, (unsigned long)header_length) != 0) {
        return -1;
    }
    if (send_all(fd, prefix, 4UL) != 0) {
        return -1;
    }
    if (message->length > 0UL && send_all(fd, message->data, message->length) != 0) {
        return -1;
    }
    if (send_all(fd, trailer, 2UL) != 0) {
        return -1;
    }
    return 0;
}

static int send_series(int fd,
                       const Subscription *subscription,
                       unsigned long subscription_id,
                       const BatchView *batch)
{
    ByteBuffer message;
    int result;

    message.data = 0;
    message.length = 0UL;
    if (encode_data_message(subscription, subscription_id, batch, &message) != 0) {
        return -1;
    }
    result = send_framed_message_chunk(fd, &message);
    free_byte_buffer(&message);
    return result;
}

static void close_client(unsigned long index)
{
    Client *client;

    client = &clients[index];
    if (!client->active) {
        return;
    }
    close(client->fd);
    free(client->subscriptions);
    memset(client, 0, sizeof(*client));
    client->fd = -1;
}

static int send_subscription_batch(Client *client, unsigned long subscription_index, unsigned long tick)
{
    Subscription *subscription;
    SeriesState *state;
    const Dataset *dataset;
    BatchView batch;
    int result;

    subscription = &client->subscriptions[subscription_index];
    state = &source_states[subscription->dataset_index];
    dataset = &datasets[subscription->dataset_index];

    if (generate_series_batch(dataset, state, tick, DEFAULT_SAMPLE_COUNT, &batch) != 0) {
        return -1;
    }
    result = send_series(client->fd, subscription, subscription->subscription_id, &batch);
    free_batch_view(&batch);
    return result;
}

static void broadcast_tick(unsigned long next_tick)
{
    unsigned long i;

    for (i = 0UL; i < MAX_CLIENTS; i += 1UL) {
        Client *client;
        unsigned long subscription_index;
        int failed;

        client = &clients[i];
        if (!client->active || client->state != CONN_STREAMING) {
            continue;
        }

        failed = 0;
        for (subscription_index = 0UL;
             subscription_index < client->subscription_count;
             subscription_index += 1UL) {
            if (send_subscription_batch(client, subscription_index, next_tick) != 0) {
                failed = 1;
                break;
            }
        }
        if (failed) {
            close_client(i);
        }
    }
    global_tick = next_tick;
}

static double current_time_ms(void)
{
    struct timeval tv;

    gettimeofday(&tv, 0);
    return ((double)tv.tv_sec * 1000.0) + ((double)tv.tv_usec / 1000.0);
}

static int ascii_lower(int c)
{
    if (c >= 'A' && c <= 'Z') {
        return c + ('a' - 'A');
    }
    return c;
}

static int ascii_case_equal_n(const char *a, const char *b, unsigned long length)
{
    unsigned long i;

    for (i = 0UL; i < length; i += 1UL) {
        if (a[i] == '\0') {
            return 0;
        }
        if (ascii_lower((unsigned char)a[i]) != ascii_lower((unsigned char)b[i])) {
            return 0;
        }
    }
    return 1;
}

static char *trim_left(char *value)
{
    while (*value && isspace((unsigned char)*value)) {
        value += 1;
    }
    return value;
}

static void trim_right_in_place(char *value)
{
    size_t length;

    length = strlen(value);
    while (length > 0U && isspace((unsigned char)value[length - 1U])) {
        value[length - 1U] = '\0';
        length -= 1U;
    }
}

static long find_header_end(const unsigned char *buffer, unsigned long length)
{
    unsigned long i;

    if (length < 4UL) {
        return -1L;
    }
    for (i = 0UL; i + 3UL < length; i += 1UL) {
        if (buffer[i] == '\r' &&
            buffer[i + 1UL] == '\n' &&
            buffer[i + 2UL] == '\r' &&
            buffer[i + 3UL] == '\n') {
            return (long)(i + 4UL);
        }
    }
    return -1L;
}

static const char *path_without_query(char *url)
{
    char *query;
    char *path;

    path = url;
    if (strncmp(path, "http://", 7U) == 0 || strncmp(path, "https://", 8U) == 0) {
        char *after_scheme;
        char *slash;

        after_scheme = strstr(path, "://");
        slash = after_scheme ? strchr(after_scheme + 3, '/') : 0;
        path = slash ? slash : (char *)"/";
    }

    query = strchr(path, '?');
    if (query) {
        *query = '\0';
    }
    return path;
}

static int parse_content_length(char *headers, unsigned long *out_length, int *has_length)
{
    char *line;
    char *next;

    *has_length = 0;
    *out_length = 0UL;

    line = strstr(headers, "\r\n");
    if (!line) {
        return -1;
    }
    line += 2;

    while (*line) {
        next = strstr(line, "\r\n");
        if (next) {
            *next = '\0';
        }
        if (ascii_case_equal_n(line, "content-length:", 15UL)) {
            char *value;
            char *end;
            unsigned long parsed;

            value = trim_left(line + 15);
            trim_right_in_place(value);
            errno = 0;
            parsed = strtoul(value, &end, 10);
            if (errno != 0 || end == value) {
                return -1;
            }
            *out_length = parsed;
            *has_length = 1;
        }
        if (!next) {
            break;
        }
        line = next + 2;
    }
    return 0;
}

static int send_simple_response(int fd,
                                int status,
                                const char *reason,
                                const char *content_type,
                                const char *body)
{
    char header[1024];
    unsigned long body_length;
    int header_length;

    body_length = (unsigned long)strlen(body);
    header_length = sprintf(header,
                            "HTTP/1.1 %d %s\r\n"
                            "Content-Type: %s\r\n"
                            "Content-Length: %lu\r\n"
                            "Cache-Control: no-store\r\n"
                            "Connection: close\r\n"
                            "\r\n",
                            status,
                            reason,
                            content_type,
                            body_length);
    if (send_all(fd, header, (unsigned long)header_length) != 0) {
        return -1;
    }
    if (body_length > 0UL && send_all(fd, body, body_length) != 0) {
        return -1;
    }
    return 0;
}

static const StaticFile *static_file_for_path(const char *path)
{
    const StaticFile *entry;

    entry = static_files;
    while (entry->path) {
        if (strcmp(entry->path, path) == 0) {
            return entry;
        }
        entry += 1;
    }
    return 0;
}

static int build_static_path(const char *file, char *out, unsigned long out_size)
{
    unsigned long root_length;
    unsigned long file_length;

    root_length = (unsigned long)strlen(static_root);
    file_length = (unsigned long)strlen(file);
    if (root_length + 1UL + file_length + 1UL > out_size) {
        return -1;
    }
    if (strcmp(static_root, ".") == 0) {
        strcpy(out, file);
    } else {
        strcpy(out, static_root);
        strcat(out, "/");
        strcat(out, file);
    }
    return 0;
}

static int serve_static(int fd, const char *path)
{
    const StaticFile *entry;
    char full_path[2048];
    FILE *file;
    long file_size;
    unsigned char *body;
    size_t read_count;
    char header[1024];
    int header_length;
    int result;

    entry = static_file_for_path(path);
    if (!entry) {
        return send_simple_response(fd,
                                    404,
                                    "Not Found",
                                    "text/plain; charset=utf-8",
                                    "Not found");
    }

    if (build_static_path(entry->file, full_path, sizeof(full_path)) != 0) {
        return send_simple_response(fd,
                                    500,
                                    "Internal Server Error",
                                    "text/plain; charset=utf-8",
                                    "Failed to load file");
    }

    file = fopen(full_path, "rb");
    if (!file) {
        return send_simple_response(fd,
                                    500,
                                    "Internal Server Error",
                                    "text/plain; charset=utf-8",
                                    "Failed to load file");
    }
    if (fseek(file, 0L, SEEK_END) != 0) {
        fclose(file);
        return send_simple_response(fd,
                                    500,
                                    "Internal Server Error",
                                    "text/plain; charset=utf-8",
                                    "Failed to load file");
    }
    file_size = ftell(file);
    if (file_size < 0L) {
        fclose(file);
        return send_simple_response(fd,
                                    500,
                                    "Internal Server Error",
                                    "text/plain; charset=utf-8",
                                    "Failed to load file");
    }
    if (fseek(file, 0L, SEEK_SET) != 0) {
        fclose(file);
        return send_simple_response(fd,
                                    500,
                                    "Internal Server Error",
                                    "text/plain; charset=utf-8",
                                    "Failed to load file");
    }

    body = (unsigned char *)malloc((size_t)(file_size == 0L ? 1L : file_size));
    if (!body) {
        fclose(file);
        return send_simple_response(fd,
                                    500,
                                    "Internal Server Error",
                                    "text/plain; charset=utf-8",
                                    "Failed to load file");
    }

    read_count = fread(body, 1U, (size_t)file_size, file);
    fclose(file);
    if (read_count != (size_t)file_size) {
        free(body);
        return send_simple_response(fd,
                                    500,
                                    "Internal Server Error",
                                    "text/plain; charset=utf-8",
                                    "Failed to load file");
    }

    header_length = sprintf(header,
                            "HTTP/1.1 200 OK\r\n"
                            "Content-Type: %s\r\n"
                            "Content-Length: %lu\r\n"
                            "Cache-Control: no-store\r\n"
                            "Connection: close\r\n"
                            "\r\n",
                            entry->content_type,
                            (unsigned long)file_size);
    result = send_all(fd, header, (unsigned long)header_length);
    if (result == 0 && file_size > 0L) {
        result = send_all(fd, body, (unsigned long)file_size);
    }
    free(body);
    return result;
}

static int send_stream_headers(int fd)
{
    const char *headers;

    headers =
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: application/octet-stream\r\n"
        "Cache-Control: no-store\r\n"
        "Transfer-Encoding: chunked\r\n"
        "Connection: keep-alive\r\n"
        "\r\n";
    return send_all(fd, headers, (unsigned long)strlen(headers));
}

static int start_stream(Client *client, const unsigned char *body, unsigned long body_length)
{
    Subscription *subscriptions;
    unsigned long subscription_count;
    unsigned long i;
    char error[512];

    subscriptions = 0;
    subscription_count = 0UL;
    error[0] = '\0';

    if (decode_subscribe_messages(body,
                                  body_length,
                                  &subscriptions,
                                  &subscription_count,
                                  error,
                                  sizeof(error)) != 0) {
        if (!error[0]) {
            set_error(error, sizeof(error), "Invalid subscribe message");
        }
        send_simple_response(client->fd,
                             400,
                             "Bad Request",
                             "text/plain; charset=utf-8",
                             error);
        return -1;
    }

    for (i = 0UL; i < subscription_count; i += 1UL) {
        if (ensure_source_state(subscriptions[i].dataset_index) != 0) {
            free(subscriptions);
            send_simple_response(client->fd,
                                 500,
                                 "Internal Server Error",
                                 "text/plain; charset=utf-8",
                                 "Failed to initialize dataset");
            return -1;
        }
    }

    if (send_stream_headers(client->fd) != 0) {
        free(subscriptions);
        return -1;
    }

    client->subscriptions = subscriptions;
    client->subscription_count = subscription_count;
    client->state = CONN_STREAMING;

    for (i = 0UL; i < subscription_count; i += 1UL) {
        if (send_subscription_batch(client, i, global_tick) != 0) {
            return -1;
        }
    }

    return 0;
}

static int process_request(Client *client)
{
    long header_end;
    unsigned long header_length;
    char headers[HEADER_BUFFER_MAX + 1UL];
    char method[16];
    char url[1024];
    char version[32];
    const char *path;
    unsigned long content_length;
    int has_content_length;
    int matched;

    header_end = find_header_end(client->request, client->request_len);
    if (header_end < 0L) {
        if (client->request_len >= HEADER_BUFFER_MAX) {
            send_simple_response(client->fd,
                                 431,
                                 "Request Header Fields Too Large",
                                 "text/plain; charset=utf-8",
                                 "Request headers too large");
            return -1;
        }
        return 0;
    }

    header_length = (unsigned long)header_end;
    if (header_length > HEADER_BUFFER_MAX) {
        send_simple_response(client->fd,
                             431,
                             "Request Header Fields Too Large",
                             "text/plain; charset=utf-8",
                             "Request headers too large");
        return -1;
    }
    memcpy(headers, client->request, (size_t)header_length);
    headers[header_length] = '\0';

    method[0] = '\0';
    url[0] = '\0';
    version[0] = '\0';
    matched = sscanf(headers, "%15s %1023s %31s", method, url, version);
    if (matched < 2) {
        send_simple_response(client->fd,
                             400,
                             "Bad Request",
                             "text/plain; charset=utf-8",
                             "Bad request");
        return -1;
    }

    path = path_without_query(url);

    if (parse_content_length(headers, &content_length, &has_content_length) != 0) {
        send_simple_response(client->fd,
                             400,
                             "Bad Request",
                             "text/plain; charset=utf-8",
                             "Invalid Content-Length");
        return -1;
    }

    if (strcmp(method, "POST") == 0 && strcmp(path, "/stream") == 0) {
        if (!has_content_length) {
            send_simple_response(client->fd,
                                 411,
                                 "Length Required",
                                 "text/plain; charset=utf-8",
                                 "Content-Length required");
            return -1;
        }
        if (content_length > REQUEST_BUFFER_MAX - header_length) {
            send_simple_response(client->fd,
                                 413,
                                 "Payload Too Large",
                                 "text/plain; charset=utf-8",
                                 "Request body too large");
            return -1;
        }
        if (client->request_len < header_length + content_length) {
            return 0;
        }
        if (start_stream(client,
                         client->request + header_length,
                         content_length) != 0) {
            return -1;
        }
        return 1;
    }

    if (strcmp(method, "GET") == 0) {
        serve_static(client->fd, path);
        return -1;
    }

    send_simple_response(client->fd,
                         405,
                         "Method Not Allowed",
                         "text/plain; charset=utf-8",
                         "Method not allowed");
    return -1;
}

static void handle_reading_client(unsigned long index)
{
    Client *client;
    ssize_t count;
    int result;

    client = &clients[index];
    if (client->request_len >= REQUEST_BUFFER_MAX) {
        send_simple_response(client->fd,
                             413,
                             "Payload Too Large",
                             "text/plain; charset=utf-8",
                             "Request too large");
        close_client(index);
        return;
    }

    count = recv(client->fd,
                 client->request + client->request_len,
                 (size_t)(REQUEST_BUFFER_MAX - client->request_len),
                 0);
    if (count < 0) {
        if (errno == EINTR) {
            return;
        }
        close_client(index);
        return;
    }
    if (count == 0) {
        close_client(index);
        return;
    }

    client->request_len += (unsigned long)count;
    result = process_request(client);
    if (result < 0) {
        close_client(index);
    }
}

static void handle_streaming_client(unsigned long index)
{
    char buffer[512];
    ssize_t count;

    count = recv(clients[index].fd, buffer, sizeof(buffer), 0);
    if (count < 0 && errno == EINTR) {
        return;
    }
    if (count <= 0) {
        close_client(index);
    }
}

static int add_client(int fd)
{
    unsigned long i;

    for (i = 0UL; i < MAX_CLIENTS; i += 1UL) {
        if (!clients[i].active) {
            memset(&clients[i], 0, sizeof(clients[i]));
            clients[i].active = 1;
            clients[i].fd = fd;
            clients[i].state = CONN_READING;
            return 0;
        }
    }
    return -1;
}

static int create_listen_socket(int port)
{
    int fd;
    int enabled;
    struct sockaddr_in address;

    fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) {
        return -1;
    }

    enabled = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, (const char *)&enabled, sizeof(enabled));

    memset(&address, 0, sizeof(address));
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_ANY);
    address.sin_port = htons((unsigned short)port);

    if (bind(fd, (struct sockaddr *)&address, sizeof(address)) != 0) {
        close(fd);
        return -1;
    }
    if (listen(fd, LISTEN_BACKLOG) != 0) {
        close(fd);
        return -1;
    }

    return fd;
}

static void init_static_root(void)
{
    const char *env_root;

    env_root = getenv("SCHARTS_ROOT");
    if (env_root && env_root[0]) {
        strncpy(static_root, env_root, sizeof(static_root) - 1U);
        static_root[sizeof(static_root) - 1U] = '\0';
        return;
    }

    if (access("index.html", R_OK) == 0) {
        strcpy(static_root, ".");
        return;
    }
    if (access("../index.html", R_OK) == 0) {
        strcpy(static_root, "..");
        return;
    }
    strcpy(static_root, ".");
}

static int parse_port(void)
{
    const char *value;
    long port;

    value = getenv("PORT");
    if (!value || !value[0]) {
        return SERVER_DEFAULT_PORT;
    }
    port = strtol(value, 0, 10);
    if (port < 1L || port > 65535L) {
        return SERVER_DEFAULT_PORT;
    }
    return (int)port;
}

static void event_loop(int listen_fd)
{
    double next_tick_ms;

    next_tick_ms = current_time_ms() + STREAM_INTERVAL_MS;

    for (;;) {
        fd_set read_fds;
        int max_fd;
        unsigned long i;
        struct timeval timeout;
        double now;
        double wait_ms;
        int ready;

        FD_ZERO(&read_fds);
        FD_SET(listen_fd, &read_fds);
        max_fd = listen_fd;

        for (i = 0UL; i < MAX_CLIENTS; i += 1UL) {
            if (clients[i].active) {
                if (clients[i].fd >= FD_SETSIZE) {
                    close_client(i);
                    continue;
                }
                FD_SET(clients[i].fd, &read_fds);
                if (clients[i].fd > max_fd) {
                    max_fd = clients[i].fd;
                }
            }
        }

        now = current_time_ms();
        wait_ms = next_tick_ms - now;
        if (wait_ms < 0.0) {
            wait_ms = 0.0;
        }
        timeout.tv_sec = (long)(wait_ms / 1000.0);
        timeout.tv_usec = (long)((wait_ms - ((double)timeout.tv_sec * 1000.0)) * 1000.0);

        ready = select(max_fd + 1, &read_fds, 0, 0, &timeout);
        if (ready < 0) {
            if (errno == EINTR) {
                continue;
            }
            perror("select");
            return;
        }

        if (ready > 0 && FD_ISSET(listen_fd, &read_fds)) {
            int client_fd;
            struct sockaddr_in client_address;
            socklen_t client_length;

            client_length = sizeof(client_address);
            client_fd = accept(listen_fd, (struct sockaddr *)&client_address, &client_length);
            if (client_fd >= 0) {
                if (client_fd >= FD_SETSIZE || add_client(client_fd) != 0) {
                    close(client_fd);
                }
            }
        }

        for (i = 0UL; i < MAX_CLIENTS; i += 1UL) {
            if (!clients[i].active) {
                continue;
            }
            if (FD_ISSET(clients[i].fd, &read_fds)) {
                if (clients[i].state == CONN_READING) {
                    handle_reading_client(i);
                } else if (clients[i].state == CONN_STREAMING) {
                    handle_streaming_client(i);
                }
            }
        }

        now = current_time_ms();
        if (now >= next_tick_ms) {
            broadcast_tick(global_tick + 1UL);
            next_tick_ms = now + STREAM_INTERVAL_MS;
        }
    }
}

int main(void)
{
    int port;
    int listen_fd;

    signal(SIGPIPE, SIG_IGN);
    init_static_root();

    port = parse_port();
    listen_fd = create_listen_socket(port);
    if (listen_fd < 0) {
        perror("listen");
        return 1;
    }

    printf("Server listening on http://localhost:%d\n", port);
    fflush(stdout);
    event_loop(listen_fd);
    close(listen_fd);
    return 0;
}
