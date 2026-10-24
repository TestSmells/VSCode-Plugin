import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

public class OrderTest {
    @Test
    public void reportsStatus() {
        Order order = new Order();
        assertEquals("ready", order.status());
    }
}
