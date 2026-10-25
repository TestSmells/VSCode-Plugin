import org.junit.jupiter.api.Test;

public class CounterTest {
    @Test
    public void incrementsCounter() {
        Counter counter = new Counter();
        counter.increment();
        counter.value();
    }
}
